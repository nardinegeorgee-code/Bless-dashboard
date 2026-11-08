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
/** How many calendar months a date range touches. A part month counts as a whole month, so a target is never cut down for a short range. */
export function monthsIn(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
}
