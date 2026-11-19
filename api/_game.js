import { db, getUser, HttpError } from './_lib.js';
import { shopConfig, fetchProductImages } from './_shopify.js';

const DAY = 86400000;
const ROUNDS = 10;
const MAX_SCORE = ROUNDS * 15;
let ready;
function ensure() {
  if (!ready) {
    ready = db()`CREATE TABLE IF NOT EXISTS game_scores (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, score INT NOT NULL, correct INT NOT NULL DEFAULT 0, played_at BIGINT NOT NULL)`;
    ready.catch(() => { ready = null; });
  }
  return ready;
}

const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const norm = (t) => String(t || '').toLowerCase().replace(/[–—‒−-]+/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, ' - ').trim();

async function pictures(cfg) {
  try {
    const q = db(), key = 'prod-img:v1';
    const hit = await q`SELECT payload FROM shop_cache WHERE key = ${key} AND fetched_at > ${Date.now() - 12 * 3600000}`;
    let pics = hit[0] ? hit[0].payload : null;
    if (!pics) {
      pics = await fetchProductImages(cfg);
      if (Object.keys(pics).length) await q`INSERT INTO shop_cache (key, fetched_at, payload) VALUES (${key}, ${Date.now()}, ${JSON.stringify(pics)}::jsonb) ON CONFLICT (key) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, payload = EXCLUDED.payload`;
    }
    const m = new Map(Object.entries(pics).map(([k, v]) => [norm(k), v]));
    return (t) => { const k = norm(t); return m.get(k) || m.get(k.split(' - ')[0]) || ''; };
  } catch (e) { return () => ''; }
}

/** Ten questions: "Which product is most often bought together with this one?", built from real orders. */
async function round() {
  const rows = await db()`SELECT items FROM shop_orders WHERE cancelled = false AND created_at >= ${Date.now() - 365 * DAY}`;
  const single = new Map(), co = new Map(), name = new Map();
  for (const o of rows) {
    const m = new Map();
    for (const i of o.items || []) if (i.k && i.t && !m.has(i.k)) { m.set(i.k, i.t); name.set(i.k, i.t); }
    const ks = [...m.keys()];
    ks.forEach((k) => single.set(k, (single.get(k) || 0) + 1));
    for (const a of ks) for (const b of ks) if (a !== b) { const c = co.get(a) || new Map(); c.set(b, (c.get(b) || 0) + 1); co.set(a, c); }
  }
  const pool = [...single.entries()].filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
  if (pool.length < 6) throw new HttpError(409, 'Not enough synced Shopify orders yet to build the game. Ask the Super Admin to press Sync now on the Shopify page.');
  const pic = await pictures(shopConfig());
  const qs = [];
  for (const a of shuffle(pool)) {
    const c = co.get(a); if (!c) continue;
    const ranked = [...c.entries()].filter(([k]) => pool.includes(k)).sort((x, y) => y[1] - x[1]);
    if (!ranked.length || ranked[0][1] < 5) continue;
    const [best, n] = ranked[0];
    if (ranked[1] && ranked[1][1] === n) continue;           // a tie would make the answer unfair
    const wrong = shuffle(pool.filter((k) => k !== a && k !== best && (c.get(k) || 0) < n * 0.8)).slice(0, 3);
    if (wrong.length < 3) continue;
    const opts = shuffle([best, ...wrong]);
    qs.push({
      p: name.get(a), pi: pic(name.get(a)),
      o: opts.map((k) => ({ t: name.get(k), i: pic(name.get(k)) })),
      a: opts.indexOf(best),
      f: `${Math.round((n / single.get(a)) * 100)}% of orders with this product also had ${name.get(best)} (${n} orders).`,
    });
    if (qs.length >= ROUNDS) break;
  }
  if (qs.length < 5) throw new HttpError(409, 'Not enough clear product pairs yet to build the game. Try again after more orders sync.');
  return qs;
}

async function board(me) {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const rows = await db()`SELECT username, MAX(score)::int AS best, COUNT(*)::int AS plays, MAX(correct)::int AS correct FROM game_scores WHERE played_at >= ${since.getTime()} GROUP BY username ORDER BY best DESC, plays ASC LIMIT 15`;
  const mine = await db()`SELECT MAX(score)::int AS best, COUNT(*)::int AS plays FROM game_scores WHERE user_id = ${me.id}`;
  return { rows, mine: { best: mine[0]?.best || 0, plays: mine[0]?.plays || 0 }, me: me.username };
}

export async function gameApi(req, res) {
  const me = await getUser(req);
  if (!me) throw new HttpError(401, 'Please sign in again.');
  await ensure();
  if (req.method === 'POST') {
    const score = Math.round(Number(req.body?.score)), correct = Math.round(Number(req.body?.correct));
    if (!(score >= 0 && score <= MAX_SCORE) || !(correct >= 0 && correct <= ROUNDS)) throw new HttpError(400, 'That score is not valid.');
    await db()`INSERT INTO game_scores (user_id, username, score, correct, played_at) VALUES (${me.id}, ${me.username}, ${score}, ${correct}, ${Date.now()})`;
    return res.json({ board: await board(me) });
  }
  if (req.query.game === 'board') return res.json({ board: await board(me) });
  return res.json({ questions: await round(), board: await board(me) });
}
