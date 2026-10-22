import { route, allow, db, getUser, mapUser, mapInstruction, mapSubmission } from './_lib.js';

// One read endpoint. The server decides what each person may see:
// the Super Admin gets everything; everyone else gets the team list,
// the instructions addressed to them and their own uploads.
export default route(async (req, res) => {
  allow(req, ['GET']);
  res.setHeader('Cache-Control', 'no-store');
  const q = db();

  const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM users`;
  if (n === 0) return res.json({ setup: true });

  const me = await getUser(req);
  if (!me) return res.json({ me: null });

  const users = (await q`SELECT * FROM users ORDER BY username_lower`).map(mapUser);
  let instructions = (await q`SELECT * FROM instructions ORDER BY created_at DESC`).map(mapInstruction);
  let submissions;

  if (me.role === 'super_admin') {
    submissions = (await q`SELECT * FROM submissions ORDER BY created_at DESC`).map(mapSubmission);
  } else {
    instructions = instructions.filter((i) => i.roles.includes(me.role) || i.userIds.includes(me.id));
    submissions = (await q`SELECT * FROM submissions WHERE user_id = ${me.id} ORDER BY created_at DESC`).map(mapSubmission);
  }

  // Ratings are an internal evaluation: only the Super Admin sees them.
  if (me.role !== 'super_admin') submissions = submissions.map((x) => ({ ...x, rating: null }));
  let speeds = [];
  if (me.role === 'super_admin') {
    speeds = (await q`SELECT instruction_id, user_id, score FROM eval_speed`).map((r) => ({ instructionId: r.instruction_id, userId: r.user_id, score: r.score === null ? null : Number(r.score) }));
  }
  res.json({ me: mapUser(me), users, instructions, submissions, speeds });
});
