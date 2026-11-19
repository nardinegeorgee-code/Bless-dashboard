import { db, getUser, HttpError } from './_lib.js';
import { shopConfig, fetchProductImages } from './_shopify.js';

const DAY = 86400000;
const ROUNDS = 10;
const MAX_SCORE = ROUNDS * 20;
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

const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pick = (arr, n) => shuffle(arr).slice(0, n);

/** Ten questions of several kinds, all built from the real orders of the last 12 months. */
async function round() {
  const rows = await db()`SELECT items, created_at, currency FROM shop_orders WHERE cancelled = false AND created_at >= ${Date.now() - 365 * DAY}`;
  const cfg = shopConfig(), tz = cfg.tz || 'Africa/Cairo';
  const single = new Map(), co = new Map(), name = new Map(), units = new Map(), cat = new Map(), prices = new Map(), byMonth = new Map();
  const wdOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' });
  const moOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const wdCount = new Map(); let multi = 0, currency = '';
  for (const o of rows) {
    if (o.currency) currency = o.currency;
    const w = wdOf.format(new Date(Number(o.created_at))); wdCount.set(w, (wdCount.get(w) || 0) + 1);
    const mk = moOf.format(new Date(Number(o.created_at)));
    const m = new Map();
    for (const i of o.items || []) {
      if (!i.k || !i.t) continue;
      name.set(i.k, i.t); units.set(i.k, (units.get(i.k) || 0) + (i.q || 0));
      if (i.c && i.c !== 'Uncategorised') cat.set(i.k, i.c);
      if (i.p > 0) { const pr = prices.get(i.k) || new Map(); const r = Math.round(i.p); pr.set(r, (pr.get(r) || 0) + 1); prices.set(i.k, pr); }
      const bm = byMonth.get(i.k) || new Map(); bm.set(mk, (bm.get(mk) || 0) + (i.q || 0)); byMonth.set(i.k, bm);
      if (!m.has(i.k)) m.set(i.k, i.t);
    }
    const ks = [...m.keys()];
    if (ks.length > 1) multi++;
    ks.forEach((k) => single.set(k, (single.get(k) || 0) + 1));
    for (const a of ks) for (const b of ks) if (a !== b) { const c = co.get(a) || new Map(); c.set(b, (c.get(b) || 0) + 1); co.set(a, c); }
  }
  const pool = [...single.entries()].filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
  if (pool.length < 6) throw new HttpError(409, 'Not enough synced Shopify orders yet to build the game. Ask the Super Admin to press Sync now on the Shopify page.');
  const pic = await pictures(cfg);
  const P = (k) => ({ t: name.get(k), i: pic(name.get(k)) });
  const make = (kind, h, o, a, f, pi) => ({ k: kind, h, o, a, f, ...(pi ? { pi } : {}) });
  const mkOpts = (correct, wrong) => { const o = shuffle([correct, ...wrong]); return [o, o.indexOf(correct)]; };
  const by = { pair: [], best: [], more: [], price: [], odd: [], month: [], day: [] };

  // 1. Bought together
  for (const a of pool) {
    const c = co.get(a); if (!c) continue;
    const ranked = [...c.entries()].filter(([k]) => pool.includes(k)).sort((x, y) => y[1] - x[1]);
    if (!ranked.length || ranked[0][1] < 5 || (ranked[1] && ranked[1][1] === ranked[0][1])) continue;
    const [best, n] = ranked[0];
    const wrong = shuffle(pool.filter((k) => k !== a && k !== best && (c.get(k) || 0) < n * 0.8)).slice(0, 3);
    if (wrong.length < 3) continue;
    const [o, ai] = mkOpts(best, wrong);
    by.pair.push(make('Bought together', `Customers who buy ${name.get(a)} most often add which product to the same order?`, o.map(P), ai,
      `${Math.round((n / single.get(a)) * 100)}% of orders with ${name.get(a)} also had ${name.get(best)} (${n} orders).`, pic(name.get(a))));
  }
  // 2. Best seller of four, and 3. head to head
  for (let t = 0; t < 12; t++) {
    const four = pick(pool, 4).sort((x, y) => units.get(y) - units.get(x));
    if (four.length === 4 && units.get(four[0]) >= units.get(four[1]) * 1.2) {
      const [o, ai] = mkOpts(four[0], four.slice(1));
      by.best.push(make('Best seller', 'Which of these four sold the most units in the last 12 months?', o.map(P), ai, `${name.get(four[0])} sold ${units.get(four[0])} units. The runner-up in this group sold ${units.get(four[1])}.`));
    }
    const two = pick(pool, 2).sort((x, y) => units.get(y) - units.get(x));
    if (two.length === 2 && units.get(two[0]) >= units.get(two[1]) * 1.3) {
      const [o, ai] = mkOpts(two[0], [two[1]]);
      by.more.push(make('Head to head', 'Which one sells more?', o.map(P), ai, `${name.get(two[0])}: ${units.get(two[0])} units. ${name.get(two[1])}: ${units.get(two[1])} units.`));
    }
  }
  // 4. Guess the price
  for (const k of pool) {
    const pr = prices.get(k); if (!pr) continue;
    const price = [...pr.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (price < 10) continue;
    const step = price >= 200 ? 25 : 10;
    const near = [0.6, 0.75, 1.3, 1.5, 1.8].map((f) => Math.max(step, Math.round((price * f) / step) * step)).filter((v) => v !== price);
    const wrong = [...new Set(near)].slice(0, 3);
    if (wrong.length < 3) continue;
    const fmt = (v) => `${v.toLocaleString('en-US')}${currency ? ' ' + currency : ''}`;
    const [o, ai] = mkOpts(price, wrong);
    by.price.push(make('Guess the price', `How much does ${name.get(k)} cost?`, o.map((v) => ({ t: fmt(v) })), ai, `${name.get(k)} costs ${fmt(price)}.`, pic(name.get(k))));
  }
  // 5. Odd one out by category
  const groups = new Map();
  for (const k of pool) if (cat.has(k)) { const g = groups.get(cat.get(k)) || []; g.push(k); groups.set(cat.get(k), g); }
  for (const [c, ks] of groups) {
    if (ks.length < 3) continue;
    for (let t = 0; t < 4; t++) {
      const others = pool.filter((k) => cat.has(k) && cat.get(k) !== c);
      if (!others.length) break;
      const odd = pick(others, 1)[0], same = pick(ks, 3);
      const [o, ai] = mkOpts(odd, same);
      by.odd.push(make('Odd one out', `Three of these are in the "${c}" category. Which one is not?`, o.map(P), ai, `${name.get(odd)} is in "${cat.get(odd)}".`));
    }
  }
  // 6. Best month for a product
  const label = (mk) => new Date(mk + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  for (const k of pool.slice(0, 20)) {
    const ranked = [...(byMonth.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length < 4 || ranked[0][1] < ranked[1][1] * 1.15) continue;
    const [o, ai] = mkOpts(ranked[0][0], pick(ranked.slice(1).map((x) => x[0]), 3));
    by.month.push(make('Best month', `In which month did ${name.get(k)} sell the most units?`, o.map((m) => ({ t: label(m) })), ai, `${label(ranked[0][0])}: ${ranked[0][1]} units.`, pic(name.get(k))));
  }
  // 7. Busiest weekday, and how many baskets hold 2+ products
  const wr = [...wdCount.entries()].sort((a, b) => b[1] - a[1]);
  if (wr.length >= 5 && wr[0][1] >= wr[1][1] * 1.05) {
    const [o, ai] = mkOpts(wr[0][0], pick(wr.slice(1).map((x) => x[0]), 3));
    by.day.push(make('Busy day', 'On which day of the week do customers place the most orders?', o.map((d) => ({ t: d })), ai, `${wr[0][0]} is the busiest day with ${wr[0][1]} orders.`));
  }
  if (rows.length >= 50) {
    const t = Math.round((multi / rows.length) * 100);
    const wrong = [...new Set([t - 25, t - 12, t + 12, t + 25].map((v) => Math.min(95, Math.max(5, Math.round(v / 5) * 5))).filter((v) => Math.abs(v - t) >= 6))].slice(0, 3);
    if (wrong.length === 3) {
      const [o, ai] = mkOpts(Math.round(t / 5) * 5, wrong.filter((v) => v !== Math.round(t / 5) * 5));
      if (o.length === 4) by.day.push(make('Basket size', 'Out of 100 orders, about how many contain two or more different products?', o.map((v) => ({ t: v + ' orders' })), ai, `About ${t} out of 100 orders have two or more different products.`));
    }
  }

  // Mix the kinds: take one from each kind in turn so the round never feels repetitive.
  const kinds = shuffle(Object.keys(by).filter((k) => by[k].length)); kinds.forEach((k) => { by[k] = shuffle(by[k]); });
  const qs = [];
  while (qs.length < ROUNDS && kinds.some((k) => by[k].length)) {
    for (const k of kinds) { if (by[k].length && qs.length < ROUNDS) qs.push(by[k].pop()); }
  }
  if (qs.length < 5) throw new HttpError(409, 'Not enough orders yet to build the game. Try again after more orders sync.');
  return shuffle(qs);
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
