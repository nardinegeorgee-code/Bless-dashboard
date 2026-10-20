import { route, allow, db, rid, HttpError, requireAdmin, mapInstruction, ROLES } from './_lib.js';

export default route(async (req, res) => {
  allow(req, ['POST', 'DELETE']);
  const admin = await requireAdmin(req);
  const q = db();

  if (req.method === 'DELETE') {
    await q`DELETE FROM instructions WHERE id = ${String(req.query.id ?? '')}`;
    return res.json({ ok: true });
  }

  const title = String(req.body?.title ?? '').trim().slice(0, 120);
  const body = String(req.body?.body ?? '').trim().slice(0, 10000);
  const roles = [...new Set(Array.isArray(req.body?.roles) ? req.body.roles : [])]
    .filter((r) => ROLES.includes(r) && r !== 'super_admin');
  const userIds = [...new Set(Array.isArray(req.body?.userIds) ? req.body.userIds : [])]
    .map(String).slice(0, 500);
  if (!title || !body) throw new HttpError(400, 'Add a title and the instructions.');
  if (!roles.length && !userIds.length) throw new HttpError(400, 'Choose at least one role or person.');

  const rows = await q`
    INSERT INTO instructions (id, title, body, roles, user_ids, created_by, created_at)
    VALUES (${rid('i')}, ${title}, ${body}, ${JSON.stringify(roles)}::jsonb, ${JSON.stringify(userIds)}::jsonb, ${admin.id}, ${Date.now()})
    RETURNING *`;
  res.json({ instruction: mapInstruction(rows[0]) });
});
