import {
  route, allow, db, rid, HttpError, mapUser, getUser, setSession, clearSession, requireUser, requireAdmin, requireReport,
  hashPassword, checkPassword, cleanName, cleanPassword,
} from './_lib.js';

// Used so a wrong username takes as long to reject as a wrong password.
let dummyHash;

const deviceOf = (req) => (/mobi|android|iphone|ipad/i.test(String(req.headers['user-agent'] || '')) ? 'mobile' : 'desktop');
const CAIRO = 'Africa/Cairo';
const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(t);
const hourOf = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, hour: '2-digit', hourCycle: 'h23' }).format(t));

const wdOf = (t) => (Number(new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, weekday: 'short' }).formatToParts(t).length) && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, weekday: 'short' }).format(t)));
const SESSION_GAP = 30 * 60 * 1000;

/** Everything the Activity report shows, for the last `days` days, with the same-length period before it for comparison. */
async function activityReport(q, days) {
  const now = Date.now(), span = days * 864e5, since = now - span, pSince = since - span;
  const rows = (await q`SELECT user_id, role, kind, page, device, started_at, last_at, secs FROM activity WHERE started_at >= ${pSince} ORDER BY started_at ASC LIMIT 80000`)
    .map((r) => ({ u: r.user_id, kind: r.kind, page: r.page === 'home' && r.role !== 'super_admin' && r.role !== 'ceo' ? 'instructions' : r.page, device: r.device || 'desktop', t: Number(r.started_at), last: Number(r.last_at), secs: Number(r.secs) || 0 }));
  const users = await q`SELECT id, username, role, created_at FROM users`;
  const ever = new Map((await q`SELECT user_id, MAX(last_at) AS last, MIN(started_at) AS first FROM activity GROUP BY user_id`).map((r) => [r.user_id, { last: Number(r.last), first: Number(r.first) }]));
  const dayList = []; for (let i = days - 1; i >= 0; i--) dayList.push(dayKey(now - i * 864e5));
  const pDayList = []; for (let i = days - 1; i >= 0; i--) pDayList.push(dayKey(since - i * 864e5));
  const dIdx = new Map(dayList.map((k, i) => [k, i])), pIdx = new Map(pDayList.map((k, i) => [k, i]));
  const blank = () => ({ views: 0, secs: 0, logins: 0, users: new Set(), sessions: 0 });
  const daily = dayList.map(blank), pDaily = pDayList.map(blank);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)), heatSecs = Array.from({ length: 7 }, () => Array(24).fill(0));
  const pages = {}, pPages = {}, devices = {};
  const byU = new Map(users.map((u) => [u.id, { id: u.id, username: u.username, role: u.role, createdAt: Number(u.created_at), logins: 0, visits: 0, secs: 0, days: new Set(), pages: {}, devices: {}, hours: Array(24).fill(0), spark: Array(days).fill(0), sparkSecs: Array(days).fill(0), sessions: [], recent: [], prev: { visits: 0, secs: 0, logins: 0, days: new Set() }, curLast: 0, current: null, _s: null }]));
  const prevTot = { views: 0, secs: 0, logins: 0, users: new Set(), sessions: 0 };
  for (const r of rows) {
    const u = byU.get(r.u); if (!u) continue;
    const isCur = r.t >= since, dk = dayKey(r.t);
    if (!isCur) {
      const d = pDaily[pIdx.get(dk)];
      prevTot.users.add(u.id); u.prev.days.add(dk);
      if (r.kind === 'login') { prevTot.logins++; u.prev.logins++; if (d) d.logins++; continue; }
      prevTot.views++; prevTot.secs += r.secs; u.prev.visits++; u.prev.secs += r.secs;
      if (d) { d.views++; d.secs += r.secs; d.users.add(u.id); }
      (pPages[r.page] ||= { visits: 0, secs: 0 }).visits++;
      // previous-period sessions
      if (!u._ps || r.t - u._ps > SESSION_GAP) prevTot.sessions++;
      u._ps = Math.max(r.last, r.t);
      continue;
    }
    const di = dIdx.get(dk), d = daily[di];
    u.days.add(dk); if (d) d.users.add(u.id);
    if (u.recent.length < 400) u.recent.push({ kind: r.kind, page: r.page, device: r.device, at: r.t, secs: r.secs });
    // sessions: a gap of more than 30 minutes, or a fresh sign-in, starts a new one
    let s = u._s;
    if (!s || r.t - s.end > SESSION_GAP || r.kind === 'login') { s = { start: r.t, end: Math.max(r.last, r.t), views: 0, secs: 0, pages: [], device: r.device }; u.sessions.push(s); u._s = s; if (d) d.sessions++; }
    s.end = Math.max(s.end, r.last, r.t + r.secs * 1000);
    if (r.kind === 'login') { u.logins++; u.devices[r.device] = (u.devices[r.device] || 0) + 1; if (d) d.logins++; continue; }
    s.views++; s.secs += r.secs; if (s.pages[s.pages.length - 1] !== r.page) s.pages.push(r.page);
    u.visits++; u.secs += r.secs; u.curLast = Math.max(u.curLast, r.last);
    if (r.last > now - 3 * 60 * 1000 && (!u.current || r.last >= u.current.last)) u.current = { page: r.page, since: r.t, last: r.last, device: r.device };
    if (d) { d.views++; d.secs += r.secs; u.spark[di]++; u.sparkSecs[di] += r.secs; }
    const h = hourOf(r.t), w = wdOf(r.t); u.hours[h]++;
    if (w >= 0) { heat[w][h]++; heatSecs[w][h] += r.secs; }
    devices[r.device] = (devices[r.device] || 0) + 1;
    const pg = (u.pages[r.page] ||= { visits: 0, secs: 0 }); pg.visits++; pg.secs += r.secs;
    const g = (pages[r.page] ||= { page: r.page, visits: 0, secs: 0, users: new Set(), last: 0 }); g.visits++; g.secs += r.secs; g.users.add(u.id); g.last = Math.max(g.last, r.t);
  }
  const all = [...byU.values()];
  const maxSecs = Math.max(1, ...all.map((u) => u.secs));
  const list = all.map((u) => {
    const ss = u.sessions, e = ever.get(u.id) || {};
    const sessSecs = ss.map((s) => Math.max(s.secs, Math.round((s.end - s.start) / 1000)));
    // engagement: how many days they came back (45%), how much time they spent compared with the busiest person (35%), how many sessions (20%)
    const score = Math.round(Math.min(1, u.days.size / Math.max(1, Math.min(days, 22))) * 45 + (u.secs / maxSecs) * 35 + Math.min(1, ss.length / Math.max(4, days / 2)) * 20);
    let streak = 0; for (let i = days - 1; i >= 0; i--) { if (u.spark[i] || u.days.has(dayList[i])) streak++; else if (i === days - 1) continue; else break; }
    const dev = Object.entries(u.devices).sort((a, b) => b[1] - a[1])[0];
    return {
      id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
      logins: u.logins, visits: u.visits, secs: u.secs, activeDays: u.days.size,
      lastSeen: e.last || 0, firstSeen: e.first || 0, online: (e.last || 0) > now - 3 * 60 * 1000, current: u.current,
      avgVisit: u.visits ? Math.round(u.secs / u.visits) : 0,
      sessions: ss.length, avgSession: ss.length ? Math.round(sessSecs.reduce((a, b) => a + b, 0) / ss.length) : 0,
      longestSession: ss.length ? Math.max(...sessSecs) : 0, pagesPerSession: ss.length ? Math.round((u.visits / ss.length) * 10) / 10 : 0,
      score, streak, device: dev ? dev[0] : (u.recent.find((r) => r.device) || {}).device || '', devices: u.devices,
      hours: u.hours, spark: u.spark, sparkSecs: u.sparkSecs,
      prev: { visits: u.prev.visits, secs: u.prev.secs, logins: u.prev.logins, activeDays: u.prev.days.size },
      pages: Object.entries(u.pages).map(([page, v]) => ({ page, ...v })).sort((a, b) => b.secs - a.secs),
      sessionList: ss.slice(-25).reverse().map((s, i) => ({ start: s.start, end: s.end, views: s.views, secs: sessSecs[ss.length - 1 - i], pages: s.pages.slice(0, 12), device: s.device })),
      recent: u.recent.slice(-120).reverse(),
    };
  });
  const cur = { views: 0, secs: 0, logins: 0, sessions: 0 };
  list.forEach((u) => { cur.views += u.visits; cur.secs += u.secs; cur.logins += u.logins; cur.sessions += u.sessions; });
  const pack = (arr, keys) => arr.map((d, i) => ({ day: keys[i], views: d.views, secs: d.secs, logins: d.logins, users: d.users.size, sessions: d.sessions }));
  const recent = [];
  for (const u of list) for (const r of u.recent.slice(0, 150)) recent.push({ userId: u.id, username: u.username, role: u.role, ...r });
  recent.sort((a, b) => b.at - a.at);
  return {
    days, now, since,
    totals: { ...cur, active: list.filter((u) => u.visits || u.logins).length, people: list.length },
    prev: { views: prevTot.views, secs: prevTot.secs, logins: prevTot.logins, sessions: prevTot.sessions, active: prevTot.users.size },
    users: list.sort((a, b) => b.lastSeen - a.lastSeen),
    pages: Object.values(pages).map((g) => ({ page: g.page, visits: g.visits, secs: g.secs, users: g.users.size, avg: g.visits ? Math.round(g.secs / g.visits) : 0, last: g.last, prev: (pPages[g.page] || {}).visits || 0 })).sort((a, b) => b.visits - a.visits),
    daily: pack(daily, dayList), prevDaily: pack(pDaily, pDayList),
    heat, heatSecs, devices,
    hours: heat.reduce((acc, r) => acc.map((v, i) => v + r[i]), Array(24).fill(0)),
    recent: recent.slice(0, 300),
    truncated: rows.length >= 80000,
  };
}

export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  const q = db();
  const { action } = req.query;
  const body = req.body || {};

  if (req.method === 'GET') {
    if (action !== 'activity') throw new HttpError(400, 'Unknown action.');
    await requireReport(req, 'act');
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
