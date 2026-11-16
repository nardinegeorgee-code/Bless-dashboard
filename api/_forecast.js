import { sr, nm, nid } from './_odoo.js';

/* Order forecast: how many units of each finished product will sell, and so how many to order.
   The method is chosen per product by testing: every method forecasts each of the last six months
   using only the months before it, and the one with the smallest error wins. */

const DAY = 86400000;
const n0 = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const addM = (ym, k) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 7);
const lastN = (y, n) => y.slice(-n);

const ses = (y, a) => { let l = y[0]; for (let i = 1; i < y.length; i++) l = a * y[i] + (1 - a) * l; return l; };
const wma = (y) => { const z = lastN(y, 6); let s = 0, w = 0; z.forEach((x, i) => { s += x * (i + 1); w += i + 1; }); return w ? s / w : 0; };
const holt = (y, h) => {
  if (y.length < 3) return mean(y);
  const a = 0.4, b = 0.2, phi = 0.8; let l = y[0], t = y[1] - y[0];
  for (let i = 1; i < y.length; i++) { const pl = l; l = a * y[i] + (1 - a) * (l + phi * t); t = b * (l - pl) + (1 - b) * phi * t; }
  let f = l, p = 1; for (let i = 1; i <= h; i++) { p *= phi; f += p * t; }
  return Math.max(0, f);
};
/** Season factor from last year, for the whole catalogue: how the target month compared with the three months before the
    forecast start, one year earlier. Pulled half-way back to 1 and capped, because one year is thin evidence. Uses past months only. */
export const seasF = (tot, end, h) => {
  const tgt = end + h - 12, b0 = end - 14;
  if (b0 < 0 || tgt < 0 || tgt > end) return null;
  const base = mean(tot.slice(b0, end - 11));
  if (!(base > 0)) return null;
  return Math.min(1.6, Math.max(0.6, 1 + (tot[tgt] / base - 1) * 0.5));
};

export const METHODS = [
  ['ma3', 'Average of the last 3 months', (y) => mean(lastN(y, 3))],
  ['ma6', 'Average of the last 6 months', (y) => mean(lastN(y, 6))],
  ['ma12', 'Average of the last 12 months', (y) => mean(lastN(y, 12))],
  ['wma', 'Last 6 months, recent months counting more', (y) => wma(y)],
  ['ses3', 'Smoothed level that changes slowly', (y) => ses(y, 0.3)],
  ['ses6', 'Smoothed level that follows recent months closely', (y) => ses(y, 0.6)],
  ['holt', 'Recent level plus its trend (trend fades out)', (y, h) => holt(y, h)],
  ['seas', 'Last 3 months, adjusted for the season seen last year', (y, h, c) => { const f = seasF(c.tot, c.end, h); return f === null ? null : mean(lastN(y, 3)) * f; }],
];
const OPT = { test: Number(process.env.FC_TEST) || 9, blend: Number(process.env.FC_BLEND) || 3, lumpy: process.env.FC_LUMPY !== '0' }; // months held back one at a time; how many of the best methods are mixed
const STEADY = new Set(['ma6', 'ma12', 'ses3']); // for products that sell in bursts, only slow averages make sense

/** One product: test every method on the last months, mix the best ones, forecast 7 months (this month and the next six). */
export function fitSeries(series, tot) {
  const N = series.length, o = series.findIndex((v) => v > 0);
  if (o < 0) return null;
  const n = N - o, origins = [], y = series.slice(o), ctx = { tot, end: N - 1 };
  for (let t = Math.max(o + 3, N - OPT.test); t < N; t++) origins.push(t);
  const zeros = lastN(y, 12).filter((v) => v === 0).length, lumpy = OPT.lumpy && lastN(y, 12).length >= 6 && zeros / lastN(y, 12).length >= 0.34;
  const pool = METHODS.filter((m) => !lumpy || STEADY.has(m[0]));
  let ranked = [];
  if (origins.length >= 3) {
    for (const [key, , fn] of pool) {
      const fs = origins.map((t) => fn(series.slice(o, t), 1, { tot, end: t - 1 }));
      if (fs.some((f) => f === null || !isFinite(f))) continue;
      ranked.push({ key, fn, fs, mae: mean(fs.map((f, i) => Math.abs(f - series[origins[i]]))) });
    }
    ranked.sort((a, b) => a.mae - b.mae); ranked = ranked.slice(0, OPT.blend);
  }
  const tested = ranked.length > 0;
  if (!tested) { const key = lumpy ? 'ma12' : n >= 2 ? 'wma' : 'ma3'; ranked = [{ key, fn: METHODS.find((m) => m[0] === key)[2], mae: 1 }]; }
  // the better a method tested, the more it counts
  const w = ranked.map((r) => 1 / (r.mae + 1e-6)), ws = w.reduce((a, b) => a + b, 0), mix = (vals) => vals.reduce((a, v, i) => a + v * w[i], 0) / ws;
  const f = Array.from({ length: 7 }, (_, i) => Math.max(0, mix(ranked.map((r) => r.fn(y, i + 1, ctx) ?? mean(lastN(y, 3))))));
  const out = { method: ranked[0].key, mix: ranked.map((r, i) => ({ k: r.key, w: Math.round((w[i] / ws) * 100) })), lumpy, n, f: f.map(r1), tested, bt: [], sigma: null, wape: null, bias: null };
  if (tested) {
    const fs = origins.map((_, i) => Math.max(0, mix(ranked.map((r) => r.fs[i])))), act = origins.map((t) => series[t]), err = fs.map((x, i) => x - act[i]), sa = act.reduce((a, b) => a + b, 0);
    out.bt = origins.map((t, i) => ({ i: t, a: r1(act[i]), f: r1(fs[i]) }));
    out.sigma = r1(Math.sqrt(mean(err.map((e) => e * e))));
    out.wape = sa > 0 ? Math.round((err.reduce((a, e) => a + Math.abs(e), 0) / sa) * 100) : null;
    out.bias = sa > 0 ? Math.round((err.reduce((a, e) => a + e, 0) / sa) * 100) : null;
  } else out.sigma = r1(Math.max(...f) * 0.5); // too new to test: assume a wide margin
  return out;
}

/** Pure analysis. rows: [{pid, d:'YYYY-MM-DD', qty, v}], products: [{pid, name, code, cat, onHand, incoming, outgoing, cost, price, tracked}]. N = complete months of history. */
export function analyse({ rows, products, today, N }) {
  const cur = today.slice(0, 7), months = Array.from({ length: N }, (_, i) => addM(cur, i - N)), idx = new Map(months.map((m, i) => [m, i]));
  const fMonths = Array.from({ length: 7 }, (_, i) => addM(cur, i)), T = Date.parse(today + 'T00:00:00Z');
  const P = new Map(products.map((p) => [p.pid, { ...p, hist: Array(N).fill(0), cur: 0, l30: 0, l90: 0, last: '', rev12: 0 }]));
  for (const r of rows) {
    const p = P.get(r.pid); if (!p) continue;
    const age = Math.round((T - Date.parse(r.d + 'T00:00:00Z')) / DAY); if (!(age >= 0)) continue;
    const ym = r.d.slice(0, 7), i = idx.get(ym);
    if (i !== undefined) p.hist[i] += r.qty; else if (ym === cur) p.cur += r.qty; else continue;
    if (age < 30) p.l30 += r.qty; if (age < 90) p.l90 += r.qty; if (age < 365) p.rev12 += r.v; if (r.d > p.last) p.last = r.d;
  }
  const list = [...P.values()]; for (const p of list) p.hist = p.hist.map((v) => Math.max(0, r1(v)));
  const tot = months.map((_, i) => list.reduce((a, p) => a + p.hist[i], 0));
  const items = [], fTot = Array(7).fill(0), btTot = new Map(); let absE = 0, actS = 0, tested = 0;
  for (const p of list) {
    // nothing sold in the last six full months and nothing this month: treat as not selling, whatever an old average says
    const quiet = p.hist.slice(-6).every((v) => v === 0);
    const fit = quiet ? null : fitSeries(p.hist, tot), pos = p.onHand + p.incoming - p.outgoing;
    if (!fit && !(p.cur > 0) && !(p.onHand > 0)) continue; // never sold in the window and nothing in stock
    const f = fit ? fit.f : Array(7).fill(p.cur > 0 ? r1(p.cur / Math.max(1, +today.slice(8, 10)) * 30) : 0);
    f.forEach((v, i) => { fTot[i] += v; });
    if (fit && fit.tested) { tested++; for (const b of fit.bt) { absE += Math.abs(b.f - b.a); actS += b.a; const g = btTot.get(b.i) || { a: 0, f: 0 }; g.a += b.a; g.f += b.f; btTot.set(b.i, g); } }
    const l3 = mean(p.hist.slice(-3)), p3 = mean(p.hist.slice(-6, -3));
    items.push({ pid: p.pid, name: p.name, code: p.code, cat: p.cat, onHand: r1(p.onHand), incoming: r1(p.incoming), outgoing: r1(p.outgoing), pos: r1(pos), tracked: p.tracked, cost: p.cost, price: p.price,
      hist: p.hist, cur: r1(p.cur), l30: r1(p.l30), l90: r1(p.l90), last: p.last, rev12: Math.round(p.rev12), f,
      method: fit ? fit.method : p.cur > 0 ? 'new' : 'none', mix: fit ? fit.mix : [], lumpy: !!(fit && fit.lumpy), tested: !!(fit && fit.tested), n: fit ? fit.n : 0, sigma: fit ? fit.sigma : r1(Math.max(...f) * 0.5), wape: fit ? fit.wape : null, bias: fit ? fit.bias : null,
      bt: fit ? fit.bt.map((b) => ({ m: months[b.i], a: b.a, f: b.f })) : [], trend: p3 > 0 ? Math.round((l3 / p3 - 1) * 100) : null, zeros: p.hist.slice(-12).filter((v) => v === 0).length });
  }
  items.sort((a, b) => b.rev12 - a.rev12);
  const bts = [...btTot.entries()].sort((a, b) => a[0] - b[0]).map(([i, g]) => ({ m: months[i], a: Math.round(g.a), f: Math.round(g.f) }));
  const btA = bts.reduce((a, b) => a + b.a, 0);
  return {
    asOf: today, months, fMonths, items: items.slice(0, 800), histTot: tot.map(Math.round), fTot: fTot.map(Math.round), curTot: Math.round(list.reduce((a, p) => a + p.cur, 0)),
    methods: Object.fromEntries(METHODS.map(([k, label]) => [k, label])),
    accuracy: { tested, items: actS > 0 ? Math.round((absE / actS) * 100) : null, total: btA > 0 ? Math.round((bts.reduce((a, b) => a + Math.abs(b.f - b.a), 0) / btA) * 100) : null, months: bts },
    seasonal: N >= 15,
  };
}

/** Reads Odoo: confirmed sales lines for up to 24 months and the stock of every active finished product. */
export async function buildForecast(cfg, today, kindP) {
  const cur = today.slice(0, 7), recentFrom = addM(cur, -12) + '-01', oldFrom = addM(cur, -24) + '-01', notes = [];
  const get = async (a, b) => {
    const [o, l] = await Promise.all([
      sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', a + ' 00:00:00'], ...(b ? [['date_order', '<', b + ' 00:00:00']] : [])], ['date_order'], { app: 'Sales', limit: 60000 }),
      sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', a + ' 00:00:00'], ...(b ? [['order_id.date_order', '<', b + ' 00:00:00']] : [])], ['order_id', 'product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 120000 }),
    ]);
    const when = new Map(o.map((x) => [x.id, String(x.date_order).slice(0, 10)]));
    return { rows: l.filter((x) => nid(x.product_id) && when.has(nid(x.order_id))).map((x) => ({ pid: nid(x.product_id), d: when.get(nid(x.order_id)), qty: n0(x.product_uom_qty), v: n0(x.price_subtotal) })), full: o.length >= 60000 || l.length >= 120000 };
  };
  // The older year only sharpens the season: if Odoo is slow with it, carry on with 12 months.
  const older = Promise.race([get(oldFrom, recentFrom).then((x) => ({ ok: true, x }), (e) => ({ ok: false, why: String(e.message || e).slice(0, 120) })), new Promise((r) => setTimeout(() => r({ ok: false, why: 'Odoo took too long' }), 28000))]);
  const [recent, list, old] = await Promise.all([
    get(recentFrom, null),
    sr(cfg, 'product.product', [['active', '=', true]], ['display_name', 'default_code', 'categ_id', 'type', 'is_storable', 'qty_available', 'virtual_available', 'incoming_qty', 'outgoing_qty', 'standard_price', 'list_price'], { app: 'Inventory', limit: 5000 }),
    older,
  ]);
  if (recent.full) notes.push('There are very many order lines in the last 12 months, so only the first 120,000 were read.');
  if (!old.ok) notes.push('Only the last 12 months of sales could be read (' + old.why + '), so the season adjustment is switched off.');
  const hasStore = list.some((p) => 'is_storable' in p), hasIO = list.some((p) => 'incoming_qty' in p);
  const products = list.filter((p) => p.type !== 'service' && kindP(p) === 'prod').map((p) => {
    const onHand = n0(p.qty_available), incoming = hasIO ? n0(p.incoming_qty) : Math.max(0, n0(p.virtual_available) - onHand), outgoing = hasIO ? n0(p.outgoing_qty) : Math.max(0, onHand - n0(p.virtual_available));
    return { pid: p.id, name: String(p.display_name || '').replace(/^\[[^\]]*\]\s*/, ''), code: p.default_code || (String(p.display_name || '').match(/^\[([^\]]+)\]/) || [])[1] || '', cat: (nm(p.categ_id) || 'No category').replace(/^All\s*\/\s*/i, ''),
      onHand, incoming, outgoing, cost: n0(p.standard_price), price: n0(p.list_price), tracked: hasStore ? !!p.is_storable : p.type === 'product' };
  });
  const rows = old.ok ? [...old.x.rows, ...recent.rows] : recent.rows;
  return { ...analyse({ rows, products, today, N: old.ok ? 24 : 12 }), notes };
}

export function forecastSections(cfg, ctx, { section, kindP }) {
  return [section('forecast', 'Order forecast', 'forecast', () => buildForecast(cfg, ctx.today, kindP))];
}
