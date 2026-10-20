import { route, allow, HttpError, requireAdmin } from './_lib.js';
import { ensureShopSchema, syncChunk } from './_shopify.js';

// POST: the Super Admin pressing "Sync now" (the page calls it until `done` is true).
// GET: Vercel's daily scheduled run, which must carry the CRON_SECRET.
export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  if (req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Not allowed.');
  } else {
    await requireAdmin(req);
  }
  await ensureShopSchema();
  res.json(await syncChunk());
});
