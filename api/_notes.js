import { db } from './_lib.js';

/* Meeting notes the Super Admin keeps on each Growth radar task. The key says which task: type|salesperson|distributor. */
let ready;
export function ensureNotes() {
  if (!ready) { ready = db()`CREATE TABLE IF NOT EXISTS task_notes (key TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', updated_at BIGINT NOT NULL)`; ready.catch(() => { ready = null; }); }
  return ready;
}
export async function loadNotes() {
  await ensureNotes();
  const out = {};
  for (const r of await db()`SELECT key, note, updated_at FROM task_notes`) out[r.key] = { note: r.note, at: Number(r.updated_at) };
  return out;
}
export async function saveNote(key, note) {
  await ensureNotes();
  const k = String(key || '').slice(0, 400), text = String(note || '').trim().slice(0, 5000);
  if (!k) return;
  if (!text) await db()`DELETE FROM task_notes WHERE key = ${k}`;
  else await db()`INSERT INTO task_notes (key, note, updated_at) VALUES (${k}, ${text}, ${Date.now()}) ON CONFLICT (key) DO UPDATE SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`;
}
