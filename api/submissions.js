import { del } from '@vercel/blob';
import { route, allow, db, rid, HttpError, requireUser, mapSubmission, mapInstruction, mapComment } from './_lib.js';

const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export default route(async (req, res) => {
  allow(req, ['POST', 'PUT', 'DELETE']);
  const me = await requireUser(req);
  const q = db();

  if (req.method === 'DELETE') {
    const id = String(req.query.id ?? '');
    const rows = await q`SELECT * FROM submissions WHERE id = ${id}`;
    const sub = rows[0];
    if (!sub) return res.json({ ok: true });
    if (me.role !== 'super_admin' && sub.user_id !== me.id) throw new HttpError(403, 'You can only delete your own uploads.');
    const revs = await q`SELECT files FROM sub_revisions WHERE submission_id = ${id}`;
    await q`DELETE FROM submissions WHERE id = ${id}`;
    await q`DELETE FROM sub_comments WHERE submission_id = ${id}`;
    await q`DELETE FROM sub_revisions WHERE submission_id = ${id}`;
    const urls = [...new Set([...(sub.files || []), ...revs.flatMap((r) => r.files || [])].map((f) => f.url).filter(Boolean))];
    if (urls.length) { try { await del(urls); } catch (e) { console.error('blob delete failed', e); } }
    return res.json({ ok: true });
  }

  const cleanFiles = (arr) => {
    const out = (Array.isArray(arr) ? arr : []).slice(0, 25).map((f) => ({
      url: String(f?.url ?? ''),
      name: String(f?.name ?? 'file').slice(0, 200),
      type: String(f?.type ?? 'application/octet-stream').slice(0, 100),
      size: Number(f?.size) || 0,
    }));
    if (out.some((f) => !BLOB_HOST.test(f.url))) throw new HttpError(400, 'Unexpected file location.');
    return out;
  };

  // Amend: the owner changes the note and/or adds files. The previous version is saved first,
  // so nothing is ever lost and the admin can read the whole history.
  if (req.method === 'PUT') {
    const rows = await q`SELECT * FROM submissions WHERE id = ${String(req.body?.id ?? '')}`;
    const sub = rows[0];
    if (!sub) throw new HttpError(404, 'That task no longer exists.');
    if (sub.user_id !== me.id) throw new HttpError(403, 'Only the person who sent this task can amend it. Use the conversation to ask for changes.');
    const note = String(req.body?.note ?? '').trim().slice(0, 5000);
    const added = cleanFiles(req.body?.addFiles);
    const files = [...(sub.files || []), ...added].slice(0, 50);
    if (!files.length && !note) throw new HttpError(400, 'Add at least one file or a note.');
    if (note === sub.note && !added.length) throw new HttpError(400, 'Nothing changed.');
    const now = Date.now();
    await q`INSERT INTO sub_revisions (id, submission_id, note, files, saved_at)
      VALUES (${rid('v')}, ${sub.id}, ${sub.note}, ${JSON.stringify(sub.files || [])}::jsonb, ${sub.edited_at ? Number(sub.edited_at) : Number(sub.created_at)})`;
    const out = await q`UPDATE submissions SET note = ${note}, files = ${JSON.stringify(files)}::jsonb, edited_at = ${now}
      WHERE id = ${sub.id} RETURNING *`;
    return res.json({ submission: mapSubmission(out[0]) });
  }

  // Conversation: the Super Admin and the task's owner can write on it.
  if (req.body?.action === 'comment') {
    const rows = await q`SELECT user_id FROM submissions WHERE id = ${String(req.body?.submissionId ?? '')}`;
    if (!rows.length) throw new HttpError(404, 'That task no longer exists.');
    if (me.role !== 'super_admin' && rows[0].user_id !== me.id) throw new HttpError(403, 'You cannot comment on this task.');
    const body = String(req.body?.body ?? '').trim().slice(0, 3000);
    if (!body) throw new HttpError(400, 'Write a comment first.');
    const out = await q`INSERT INTO sub_comments (id, submission_id, user_id, username, role, body, created_at)
      VALUES (${rid('c')}, ${String(req.body.submissionId)}, ${me.id}, ${me.username}, ${me.role}, ${body}, ${Date.now()})
      RETURNING *`;
    return res.json({ comment: mapComment(out[0]) });
  }

  const note = String(req.body?.note ?? '').trim().slice(0, 5000);
  const instructionId = String(req.body?.instructionId ?? '');
  const files = cleanFiles(req.body?.files);
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
