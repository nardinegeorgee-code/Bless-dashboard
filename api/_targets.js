import { db } from './_lib.js';

/* A monthly sales target per salesperson, set by the Super Admin. */
let ready;
export function ensureTargets() {
  if (!ready) { ready = db()`CREATE TABLE IF NOT EXISTS rep_targets (rep TEXT PRIMARY KEY, monthly NUMERIC NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)`; ready.catch(() => { ready = null; }); }
  return ready;
}
export async function loadTargets() {
  await ensureTargets();
  return new Map((await db()`SELECT rep, monthly FROM rep_targets`).map((r) => [r.rep, Number(r.monthly) || 0]));
}
export async function saveTarget(rep, monthly) {
  await ensureTargets();
  const q = db(), name = String(rep || '').trim().slice(0, 120), amount = Math.max(0, Number(monthly) || 0);
  if (!name) return;
  if (!amount) await q`DELETE FROM rep_targets WHERE rep = ${name}`;
  else await q`INSERT INTO rep_targets (rep, monthly, updated_at) VALUES (${name}, ${amount}, ${Date.now()}) ON CONFLICT (rep) DO UPDATE SET monthly = EXCLUDED.monthly, updated_at = EXCLUDED.updated_at`;
}
/** How many months a date range covers (a part month counts by its days). */
export function monthsIn(a, b) {
  let t = 0, d = new Date(a.slice(0, 7) + '-01T12:00:00Z');
  const from = Date.parse(a + 'T12:00:00Z'), to = Date.parse(b + 'T12:00:00Z');
  for (let i = 0; i < 400 && d.getTime() <= to; i++) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), first = Date.UTC(y, m, 1, 12), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), last = Date.UTC(y, m, dim, 12);
    const days = Math.max(0, (Math.min(last, to) - Math.max(first, from)) / 86400000 + 1);
    t += days / dim; d = new Date(Date.UTC(y, m + 1, 1, 12));
  }
  return t;
}
