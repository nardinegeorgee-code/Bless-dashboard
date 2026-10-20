import {
  route, allow, db, rid, HttpError, requireAdmin, mapUser, setSession,
  hashPassword, cleanName, cleanPassword, cleanRole, cleanEmail,
} from './_lib.js';

export default route(async (req, res) => {
  allow(req, ['POST', 'PATCH', 'DELETE']);
  const admin = await requireAdmin(req);
  const q = db();

  if (req.method === 'POST') {
    const name = cleanName(req.body?.username);
    const pw = cleanPassword(req.body?.password);
    const role = cleanRole(req.body?.role);
    const email = cleanEmail(req.body?.email);
    const hash = await hashPassword(pw);
    try {
      const rows = await q`
        INSERT INTO users (id, username, username_lower, role, email, password_hash, sv, created_at)
        VALUES (${rid('u')}, ${name}, ${name.toLowerCase()}, ${role}, ${email}, ${hash}, 0, ${Date.now()})
        RETURNING *`;
      return res.json({ user: mapUser(rows[0]) });
    } catch (e) {
      if (String(e.message).includes('username_lower') || e.code === '23505') throw new HttpError(409, 'That username is taken.');
      throw e;
    }
  }

  const id = String(req.method === 'DELETE' ? req.query.id : req.body?.id ?? '');
  const rows = await q`SELECT * FROM users WHERE id = ${id}`;
  const target = rows[0];
  if (!target) throw new HttpError(404, 'That user no longer exists.');
  const [{ n: admins }] = await q`SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin'`;

  if (req.method === 'DELETE') {
    if (target.id === admin.id) throw new HttpError(400, 'You cannot remove your own account.');
    if (target.role === 'super_admin' && admins <= 1) throw new HttpError(400, 'The hub needs at least one Super Admin.');
    await q`DELETE FROM users WHERE id = ${id}`;
    return res.json({ ok: true });
  }

  // PATCH: change role and/or password
  if (req.body?.role !== undefined) {
    const role = cleanRole(req.body.role);
    if (target.role === 'super_admin' && role !== 'super_admin' && admins <= 1) {
      throw new HttpError(400, 'The hub needs at least one Super Admin.');
    }
    await q`UPDATE users SET role = ${role} WHERE id = ${id}`;
  }
  if (req.body?.email !== undefined) {
    const email = cleanEmail(req.body.email);
    await q`UPDATE users SET email = ${email} WHERE id = ${id}`;
  }
  if (req.body?.password !== undefined) {
    const pw = cleanPassword(req.body.password);
    const hash = await hashPassword(pw);
    // Bumping sv signs the person out everywhere; the admin changing their own password stays signed in.
    const updated = await q`UPDATE users SET password_hash = ${hash}, sv = sv + 1 WHERE id = ${id} RETURNING *`;
    if (id === admin.id) await setSession(res, updated[0]);
  }
  const fresh = await q`SELECT * FROM users WHERE id = ${id}`;
  res.json({ user: mapUser(fresh[0]) });
});
