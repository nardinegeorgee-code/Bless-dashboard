import { del } from '@vercel/blob';
import { route, allow, db, rid, HttpError, requireUser, mapSubmission, mapInstruction } from './_lib.js';

const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export default route(async (req, res) => {
  allow(req, ['POST', 'DELETE']);
  const me = await requireUser(req);
  const q = db();

  if (req.method === 'DELETE') {
    const id = String(req.query.id ?? '');
    const rows = await q`SELECT * FROM submissions WHERE id = ${id}`;
    const sub = rows[0];
    if (!sub) return res.json({ ok: true });
    if (me.role !== 'super_admin' && sub.user_id !== me.id) throw new HttpError(403, 'You can only delete your own uploads.');
    await q`DELETE FROM submissions WHERE id = ${id}`;
    const urls = (sub.files || []).map((f) => f.url).filter(Boolean);
    if (urls.length) { try { await del(urls); } catch (e) { console.error('blob delete failed', e); } }
    return res.json({ ok: true });
  }

  const note = String(req.body?.note ?? '').trim().slice(0, 5000);
  const instructionId = String(req.body?.instructionId ?? '');
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).slice(0, 25).map((f) => ({
    url: String(f?.url ?? ''),
    name: String(f?.name ?? 'file').slice(0, 200),
    type: String(f?.type ?? 'application/octet-stream').slice(0, 100),
    size: Number(f?.size) || 0,
  }));
  if (files.some((f) => !BLOB_HOST.test(f.url))) throw new HttpError(400, 'Unexpected file location.');
  if (!files.length && !note) throw new HttpError(400, 'Add at least one file or a note.');

  if (instructionId) {
    const rows = await q`SELECT * FROM instructions WHERE id = ${instructionId}`;
    if (!rows.length) throw new HttpError(404, 'That instruction no longer exists.');
    const ins = mapInstruction(rows[0]);
    if (me.role !== 'super_admin' && !ins.roles.includes(me.role) && !ins.userIds.includes(me.id)) {
      throw new HttpError(403, 'That instruction was not sent to you.');
    }
  }

  const rows = await q`
    INSERT INTO submissions (id, user_id, username, role, instruction_id, note, files, created_at)
    VALUES (${rid('s')}, ${me.id}, ${me.username}, ${me.role}, ${instructionId}, ${note}, ${JSON.stringify(files)}::jsonb, ${Date.now()})
    RETURNING *`;
  res.json({ submission: mapSubmission(rows[0]) });
});
