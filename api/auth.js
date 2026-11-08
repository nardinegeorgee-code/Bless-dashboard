import {
  route, allow, db, rid, HttpError, mapUser, getUser, setSession, clearSession, requireUser, requireAdmin,
  hashPassword, checkPassword, cleanName, cleanPassword,
} from './_lib.js';

// Used so a wrong username takes as long to reject as a wrong password.
let dummyHash;

const deviceOf = (req) => (/mobi|android|iphone|ipad/i.test(String(req.headers['user-agent'] || '')) ? 'mobile' : 'desktop');
const CAIRO = 'Africa/Cairo';
const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(t);
const hourOf = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, hour: '2-digit', hourCycle: 'h23' }).format(t));

async function activityReport(q, days) {
  const since = Date.now() - days * 864e5;
  const rows = await q`SELECT * FROM activity WHERE started_at >= ${since} ORDER BY started_at DESC LIMIT 30000`;
  const users = await q`SELECT id, username, role FROM users`;
  const byU = new Map(users.map((u) => [u.id, { id: u.id, username: u.username, role: u.role, logins: 0, visits: 0, secs: 0, lastSeen: 0, firstSeen: 0, days: new Set(), pages: {}, devices: {} }]));
  const pages = {}, daily = {}, hours = Array(24).fill(0);
  const now = Date.now();
  for (const r of rows) {
    const u = byU.get(r.user_id); if (!u) continue;
    const t = Number(r.started_at), last = Number(r.last_at), secs = r.secs;
    u.lastSeen = Math.max(u.lastSeen, last); u.firstSeen = u.firstSeen ? Math.min(u.firstSeen, t) : t;
    const dk = dayKey(t); u.days.add(dk);
    const d = (daily[dk] ||= { day: dk, users: new Set(), visits: 0, logins: 0, secs: 0 });
    d.users.add(u.id);
    if (r.kind === 'login') { u.logins++; d.logins++; u.devices[r.device] = (u.devices[r.device] || 0) + 1; continue; }
    u.visits++; u.secs += secs; d.visits++; d.secs += secs; hours[hourOf(t)]++;
    const pg = (u.pages[r.page] ||= { visits: 0, secs: 0 }); pg.visits++; pg.secs += secs;
    const g = (pages[r.page] ||= { page: r.page, visits: 0, secs: 0, users: new Set() }); g.visits++; g.secs += secs; g.users.add(u.id);
  }
  const list = [...byU.values()].map((u) => ({ id: u.id, username: u.username, role: u.role, logins: u.logins, visits: u.visits, secs: u.secs, lastSeen: u.lastSeen, firstSeen: u.firstSeen, activeDays: u.days.size, devices: u.devices,
    avgVisit: u.visits ? Math.round(u.secs / u.visits) : 0, online: u.lastSeen > now - 3 * 60 * 1000,
    pages: Object.entries(u.pages).map(([page, v]) => ({ page, ...v })).sort((a, b) => b.secs - a.secs) }));
  return {
    days, now,
    users: list.sort((a, b) => b.lastSeen - a.lastSeen),
    pages: Object.values(pages).map((g) => ({ page: g.page, visits: g.visits, secs: g.secs, users: g.users.size })).sort((a, b) => b.visits - a.visits),
    daily: Object.values(daily).map((d) => ({ day: d.day, users: d.users.size, visits: d.visits, logins: d.logins, secs: d.secs })).sort((a, b) => a.day.localeCompare(b.day)),
    hours,
    recent: rows.slice(0, 150).map((r) => ({ userId: r.user_id, username: r.username, role: r.role, kind: r.kind, page: r.page, device: r.device, at: Number(r.started_at), secs: r.secs })),
    truncated: rows.length >= 30000,
  };
}

export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  const q = db();
  const { action } = req.query;
  const body = req.body || {};

  if (req.method === 'GET') {
    if (action !== 'activity') throw new HttpError(400, 'Unknown action.');
    await requireAdmin(req);
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    return res.json(await activityReport(q, days));
  }

  if (action === 'ping') {
    const u = await requireUser(req);
    const id = String(body.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const page = String(body.page ?? '').slice(0, 60);
    if (!id || !page) throw new HttpError(400, 'Bad ping.');
    const secs = Math.max(0, Math.min(6 * 3600, Math.round(Number(body.secs) || 0)));
    const now = Date.now();
    await q`INSERT INTO activity (id, user_id, username, role, kind, page, device, started_at, last_at, secs)
      VALUES (${id}, ${u.id}, ${u.username}, ${u.role}, 'view', ${page}, ${deviceOf(req)}, ${now}, ${now}, ${secs})
      ON CONFLICT (id) DO UPDATE SET secs = GREATEST(activity.secs, EXCLUDED.secs), last_at = EXCLUDED.last_at
      WHERE activity.user_id = EXCLUDED.user_id`;
    return res.json({ ok: true });
  }

  if (action === 'logout') {
    clearSession(res);
    return res.json({ ok: true });
  }

  if (action === 'setup') {
    const name = cleanName(body.username);
    const pw = cleanPassword(body.password);
    const id = rid('u');
    const hash = await hashPassword(pw);
    // Only succeeds while the table is empty, so setup can never be used to add a second admin.
    const rows = await q`
      INSERT INTO users (id, username, username_lower, role, password_hash, sv, created_at)
      SELECT ${id}, ${name}, ${name.toLowerCase()}, 'super_admin', ${hash}, 0, ${Date.now()}
      WHERE NOT EXISTS (SELECT 1 FROM users)
      RETURNING *`;
    if (!rows.length) throw new HttpError(409, 'The hub is already set up. Sign in instead.');
    await setSession(res, rows[0]);
    return res.json({ user: mapUser(rows[0]) });
  }

  if (action === 'login') {
    const name = String(body.username ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const pw = String(body.password ?? '');
    const rows = await q`SELECT * FROM users WHERE username_lower = ${name}`;
    const user = rows[0];
    if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
    const ok = await checkPassword(pw, user ? user.password_hash : dummyHash);
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.');
    await setSession(res, user);
    try {
      const now = Date.now();
      await q`INSERT INTO activity (id, user_id, username, role, kind, page, device, started_at, last_at, secs)
        VALUES (${rid('a')}, ${user.id}, ${user.username}, ${user.role}, 'login', 'login', ${deviceOf(req)}, ${now}, ${now}, 0)`;
    } catch (e) { /* tracking must never block sign-in */ }
    return res.json({ user: mapUser(user) });
  }

  throw new HttpError(400, 'Unknown action.');
});
