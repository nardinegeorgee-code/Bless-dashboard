import {
  route, allow, db, rid, HttpError, mapUser, getUser, setSession, clearSession,
  hashPassword, checkPassword, cleanName, cleanPassword,
} from './_lib.js';

// Used so a wrong username takes as long to reject as a wrong password.
let dummyHash;

export default route(async (req, res) => {
  allow(req, ['POST']);
  const q = db();
  const { action } = req.query;
  const body = req.body || {};

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
    return res.json({ user: mapUser(user) });
  }

  throw new HttpError(400, 'Unknown action.');
});
