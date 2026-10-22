import { route, allow, db, HttpError, requireAdmin, mapInstruction } from './_lib.js';

const HOUR = 3600000;
export const DEFAULTS = { weights: { speed: 40, accuracy: 40, behaviour: 20 } };
const TZ = () => process.env.DASHBOARD_TZ || 'Africa/Cairo';

function monthKeyer(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  return (ms) => { const p = f.formatToParts(new Date(ms)); return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value; };
}
const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const prevKey = (key) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

/** Pure scoring for one month. users = team members (not Super Admin); instructions/subs use API row shapes. */
export function computeMonth({ month, users, instructions, subs, behaviour, speeds, settings, keyOf }) {
  const { weights } = settings;
  const monthIns = instructions.filter((i) => keyOf(i.createdAt) === month);
  const rows = users.map((u) => {
    const items = [];
    for (const i of monthIns) {
      if (!((i.roles || []).includes(u.role) || (i.userIds || []).includes(u.id))) continue;
      const mine = subs.filter((s) => s.instructionId === i.id && s.userId === u.id).sort((a, b) => a.createdAt - b.createdAt);
      const first = mine[0];
      const hours = first ? Math.max(0, (first.createdAt - i.createdAt) / HOUR) : null;
      const sp = speeds.find((x) => x.instructionId === i.id && x.userId === u.id);
      const speed = sp && sp.score !== null ? sp.score : null;
      const rated = mine.filter((s) => s.rating !== null && s.rating !== undefined);
      items.push({
        id: i.id, title: i.title, createdAt: i.createdAt, respondedAt: first ? first.createdAt : null,
        hours: r1(hours), speed: r1(speed), accuracy: r1(avg(rated.map((s) => s.rating))),
        responses: mine.map((s) => ({ id: s.id, rating: s.rating ?? null, createdAt: s.createdAt })),
      });
    }
    const b = behaviour.find((x) => x.userId === u.id) || null;
    const speed = avg(items.map((x) => x.speed).filter((v) => v !== null));
    const accuracy = avg(items.map((x) => x.accuracy).filter((v) => v !== null));
    const beh = b && b.score !== null ? b.score : null;
    const parts = [['speed', speed], ['accuracy', accuracy], ['behaviour', beh]].filter(([, v]) => v !== null);
    const wsum = parts.reduce((a, [k]) => a + weights[k], 0);
    const final = parts.length && wsum ? parts.reduce((a, [k, v]) => a + weights[k] * v, 0) / wsum : null;
    return {
      userId: u.id, username: u.username, role: u.role,
      speed: r1(speed), accuracy: r1(accuracy), behaviour: beh, behaviourNote: b ? b.note : '',
      final: r1(final), complete: parts.length === 3,
      tasks: items.length, answered: items.filter((x) => x.respondedAt).length,
      unrated: items.reduce((a, x) => a + x.responses.filter((s) => s.rating === null).length, 0),
      unspeed: items.filter((x) => x.speed === null).length,
      items: items.sort((a, b2) => b2.createdAt - a.createdAt),
    };
  });
  const sorted = [...rows].sort((a, b) => (b.final ?? -1) - (a.final ?? -1) || a.username.localeCompare(b.username));
  sorted.forEach((r, i) => { r.rank = r.final === null ? null : i && sorted[i - 1].final === r.final ? sorted[i - 1].rank : i + 1; });
  return sorted;
}

async function loadSettings(q) {
  const r = await q`SELECT value FROM eval_settings WHERE key = 'main'`;
  const v = r[0]?.value || {};
  return { weights: { ...DEFAULTS.weights, ...(v.weights || {}) } };
}
const num = (v, lo, hi, what) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${what}: enter a number from ${lo} to ${hi}.`); return n; };

export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  const q = db();
  const keyOf = monthKeyer(TZ());

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.action === 'rate') {
      const rating = b.rating === null || b.rating === '' || b.rating === undefined ? null : Math.round(num(b.rating, 0, 100, 'Accuracy'));
      const r = await q`UPDATE submissions SET rating = ${rating}, rated_at = ${Date.now()} WHERE id = ${String(b.submissionId || '')} RETURNING id`;
      if (!r.length) throw new HttpError(404, 'That response no longer exists.');
      return res.json({ ok: true });
    }
    if (b.action === 'speed') {
      const ins = await q`SELECT id FROM instructions WHERE id = ${String(b.instructionId || '')}`;
      const u = await q`SELECT id, role FROM users WHERE id = ${String(b.userId || '')}`;
      if (!ins.length || !u.length || u[0].role === 'super_admin') throw new HttpError(404, 'That instruction or team member was not found.');
      const score = b.score === null || b.score === '' || b.score === undefined ? null : Math.round(num(b.score, 0, 100, 'Speed'));
      if (score === null) await q`DELETE FROM eval_speed WHERE instruction_id = ${ins[0].id} AND user_id = ${u[0].id}`;
      else await q`INSERT INTO eval_speed (instruction_id, user_id, score, updated_at) VALUES (${ins[0].id}, ${u[0].id}, ${score}, ${Date.now()})
        ON CONFLICT (instruction_id, user_id) DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at`;
      return res.json({ ok: true });
    }
    if (b.action === 'behaviour') {
      const month = String(b.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Choose a month.');
      const u = await q`SELECT id, role FROM users WHERE id = ${String(b.userId || '')}`;
      if (!u.length || u[0].role === 'super_admin') throw new HttpError(404, 'That team member was not found.');
      const score = b.score === null || b.score === '' || b.score === undefined ? null : Math.round(num(b.score, 0, 100, 'Behaviour'));
      const note = String(b.note || '').trim().slice(0, 500);
      if (score === null && !note) await q`DELETE FROM eval_behaviour WHERE month = ${month} AND user_id = ${u[0].id}`;
      else await q`INSERT INTO eval_behaviour (month, user_id, score, note, updated_at) VALUES (${month}, ${u[0].id}, ${score}, ${note}, ${Date.now()})
        ON CONFLICT (month, user_id) DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`;
      return res.json({ ok: true });
    }
    if (b.action === 'settings') {
      const w = b.weights || {};
      const weights = { speed: num(w.speed, 0, 100, 'Speed weight'), accuracy: num(w.accuracy, 0, 100, 'Accuracy weight'), behaviour: num(w.behaviour, 0, 100, 'Behaviour weight') };
      if (weights.speed + weights.accuracy + weights.behaviour <= 0) throw new HttpError(400, 'At least one weight must be above zero.');
      await q`INSERT INTO eval_settings (key, value) VALUES ('main', ${JSON.stringify({ weights })}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
      return res.json({ ok: true });
    }
    throw new HttpError(400, 'Unknown action.');
  }

  const now = Date.now();
  const cur = keyOf(now);
  const months = Array.from({ length: 12 }, (_, i) => { let k = cur; for (let j = 0; j < 11 - i; j++) k = prevKey(k); return k; });
  const month = months.includes(req.query.month) ? req.query.month : cur;
  const settings = await loadSettings(q);
  const users = (await q`SELECT id, username, role FROM users WHERE role <> 'super_admin' ORDER BY username_lower`);
  const instructions = (await q`SELECT * FROM instructions`).map(mapInstruction);
  const subs = (await q`SELECT id, user_id, instruction_id, created_at, rating FROM submissions WHERE instruction_id <> ''`)
    .map((s) => ({ id: s.id, userId: s.user_id, instructionId: s.instruction_id, createdAt: Number(s.created_at), rating: s.rating === null ? null : Number(s.rating) }));
  const speeds = (await q`SELECT instruction_id, user_id, score FROM eval_speed`).map((r) => ({ instructionId: r.instruction_id, userId: r.user_id, score: r.score === null ? null : Number(r.score) }));
  const beh = (m) => q`SELECT user_id, score, note FROM eval_behaviour WHERE month = ${m}`;
  const toB = (rows) => rows.map((r) => ({ userId: r.user_id, score: r.score === null ? null : Number(r.score), note: r.note }));
  const rows = computeMonth({ month, users, instructions, subs, behaviour: toB(await beh(month)), speeds, settings, keyOf });
  const pk = prevKey(month);
  const prev = computeMonth({ month: pk, users, instructions, subs, behaviour: toB(await beh(pk)), speeds, settings, keyOf });
  const pm = new Map(prev.map((r) => [r.userId, r]));
  rows.forEach((r) => { const p = pm.get(r.userId); r.prevFinal = p ? p.final : null; r.prevRank = p ? p.rank : null; });
  res.json({ month, monthLabel: label(month), months: months.map((k) => ({ key: k, label: label(k) })), settings, rows, unrated: rows.reduce((a, r) => a + r.unrated, 0), unspeed: rows.reduce((a, r) => a + r.unspeed, 0) });
});
