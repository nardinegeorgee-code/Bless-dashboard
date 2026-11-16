/**
 * Growth radar: looks at the last 12 months of orders, order lines and invoices and digs out money that is easy to miss:
 * distributors late to reorder or gone quiet, best-sellers a distributor never bought, products they stopped buying,
 * distributors buying less, orders that were never invoiced, overdue invoices, when orders arrive, and how each city is doing.
 * Every finding names the distributor and the salesperson, so the page can turn it into tasks.
 */
import { call, sr, nm, nid, fieldsOf } from './_odoo.js';

const DAY = 86400000;
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const dnum = (s) => Math.round(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / DAY);
const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r0 = (v) => Math.round(v);
/** Orders of one distributor, one row per day (value summed), oldest first: the proof behind a rhythm. */
const dayHist = (orders, last) => { const m = new Map(); for (const o of orders) m.set(o.d, (m.get(o.d) || 0) + o.net); return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-last).map(([d, v]) => ({ d, v: Math.round(v) })); };
const top = (list, n, key = 'value') => [...list].sort((a, b) => b[key] - a[key]).slice(0, n);

/** Thresholds, in one place. */
export const RULES = { window: 365, active: 180, recent: 90, sleepAfter: 120, lateFactor: 1.5, dueFactor: 0.8, shrink: 0.7, corePen: 30, coreMax: 10, dropQuiet: 120, uninvoicedAfter: 2 };

/**
 * Pure analysis, so it can be tested without Odoo.
 * orders: [{id,name,d,cust,city,rep,net,toInv|null}]  lines: [{oid,prod,qty,v,toInv}]  unpaid: [{name,cust,rep,due,amt}] or null
 */
export function analyse({ orders, lines, unpaid, today }) {
  const T = dnum(today), R = RULES;
  const O = orders.filter((o) => o.net > 0 && T - dnum(o.d) <= R.window && dnum(o.d) <= T).map((o) => ({ ...o, n: dnum(o.d), age: T - dnum(o.d) }));
  const byId = new Map(O.map((o) => [o.id, o]));

  // ---- distributors
  const C = new Map();
  for (const o of O) {
    const c = C.get(o.cust) || { cust: o.cust, orders: [], sales: 0, s180: 0, last90: 0, prior90: 0, cities: new Map() };
    c.orders.push(o); c.sales += o.net; if (o.age <= R.active) c.s180 += o.net;
    if (o.age <= R.recent) c.last90 += o.net; else if (o.age <= R.recent * 2) c.prior90 += o.net;
    c.cities.set(o.city, (c.cities.get(o.city) || 0) + 1); C.set(o.cust, c);
  }
  for (const c of C.values()) {
    c.orders.sort((a, b) => a.n - b.n);
    const days = [...new Set(c.orders.map((o) => o.n))], gaps = days.slice(1).map((d, i) => d - days[i]);
    const lastO = c.orders[c.orders.length - 1];
    c.rep = lastO.rep; c.city = [...c.cities.entries()].sort((a, b) => b[1] - a[1])[0][0];
    c.last = lastO.d; c.since = lastO.age; c.visits = days.length; c.gap = gaps.length >= 2 ? median(gaps) : 0;
    c.avg = median(c.orders.slice(-6).map((o) => o.net));
    c.active = c.since <= R.active;
  }
  const all = [...C.values()], active = all.filter((c) => c.active);

  // ---- 1. reorder clock: late, due now, sleeping
  const reorder = [];
  for (const c of all) {
    if (c.since > R.sleepAfter) { if (c.orders.length >= 2) reorder.push({ status: 'sleep', value: c.avg }); else continue; }
    else if (c.gap >= 3 && c.since > Math.max(c.gap * R.lateFactor, c.gap + 7)) reorder.push({ status: 'late', value: c.avg });
    else if (c.gap >= 3 && c.since >= c.gap * R.dueFactor && c.since >= 5) reorder.push({ status: 'due', value: c.avg });
    else continue;
    Object.assign(reorder[reorder.length - 1], { hist: dayHist(c.orders, 14), cust: c.cust, rep: c.rep, city: c.city, last: c.last, since: c.since, gap: r0(c.gap), orders: c.orders.length, value: r0(c.avg) });
  }
  const flagged = new Set(reorder.filter((x) => x.status !== 'due').map((x) => x.cust));

  // ---- 2. buying less than before (last 90 days against the 90 before)
  const total90 = all.reduce((a, c) => a + c.prior90, 0);
  const shrink = all.filter((c) => !flagged.has(c.cust) && c.prior90 > Math.max(0, total90 * 0.002) && c.last90 > 0 && c.last90 < c.prior90 * R.shrink)
    .map((c) => ({ hist: dayHist(c.orders.filter((o) => o.age <= R.recent * 2).map((o) => ({ ...o, d: o.d })), 30).map((h) => ({ ...h, p: T - dnum(h.d) <= R.recent ? 'last' : 'before' })), cust: c.cust, rep: c.rep, city: c.city, prior: r0(c.prior90), last90: r0(c.last90), value: r0(c.prior90 - c.last90), drop: r0((1 - c.last90 / c.prior90) * 100) }));

  // ---- products per distributor
  const CP = new Map(); // cust -> prod -> {recent, old, orders:Set, lastN}
  const P = new Map();  // prod -> {name, buyers:Set (active window), spend:[...]}
  for (const l of lines) {
    const o = byId.get(l.oid); if (!o || !(l.v > 0) || !l.prod) continue;
    if (!CP.has(o.cust)) CP.set(o.cust, new Map());
    const m = CP.get(o.cust), g = m.get(l.prod) || { v180: 0, vOld: 0, vQuietBefore: 0, ordersBefore: new Set(), lastN: 0, days: new Set() };
    g.days.add(o.n);
    if (o.age <= R.active) g.v180 += l.v; else g.vOld += l.v;
    if (o.age > R.dropQuiet) { g.vQuietBefore += l.v; g.ordersBefore.add(o.id); }
    g.lastN = Math.max(g.lastN, o.n); m.set(l.prod, g);
  }
  for (const c of active) for (const [prod, g] of (CP.get(c.cust) || new Map())) {
    if (g.v180 <= 0) continue;
    const p = P.get(prod) || { name: prod, buyers: new Set(), spend: [] }; p.buyers.add(c.cust); p.spend.push(g.v180); P.set(prod, p);
  }
  const core = active.length >= 4
    ? [...P.values()].map((p) => ({ name: p.name, buyers: p.buyers.size, pen: (p.buyers.size / active.length) * 100, med: median(p.spend), set: p.buyers }))
      .filter((p) => p.pen >= R.corePen && p.buyers >= 3).sort((a, b) => b.pen - a.pen || b.med - a.med).slice(0, R.coreMax)
    : [];
  const medSize = median(active.map((c) => c.s180)) || 1;

  // ---- 3. white space: best-sellers a distributor has never bought
  const whiteGaps = [];
  for (const c of active) for (const p of core) {
    if (c.since > R.sleepAfter) continue; // quiet distributors are a win-back call first
    const g = (CP.get(c.cust) || new Map()).get(p.name);
    if (g) continue;
    whiteGaps.push({ cust: c.cust, rep: c.rep, prod: p.name, pen: r0(p.pen), buyers: p.buyers, med: r0(p.med), size: Math.round(clamp(c.s180 / medSize, 0.3, 2) * 100) / 100, value: r0(p.med * clamp(c.s180 / medSize, 0.3, 2)) });
  }
  const rowsM = top(active, 18, 's180').map((c) => {
    const m = CP.get(c.cust) || new Map(), mx = Math.max(1, ...core.map((p) => (m.get(p.name) || {}).v180 || 0));
    return { cust: c.cust, rep: c.rep, sales: r0(c.s180), cells: core.map((p) => { const g = m.get(p.name); if (!g) return 0; if (g.v180 <= 0) return 1; return 2 + Math.min(3, Math.floor((g.v180 / mx) * 3.999)); }) };
  });

  // ---- 4. products they stopped buying (bought on 2+ orders before, nothing for 120 days, distributor ordered in the last 45 days and is not late)
  const dropped = [];
  for (const c of all) {
    // "still ordering" must be true: ordered in the last 45 days, on 2+ different days in the last 120, and not late for its own rhythm.
    // Anything weaker is the reorder clock's job (call / win back), not a "why did you stop products" question.
    const recentDays = new Set(c.orders.filter((o) => o.age <= R.dropQuiet).map((o) => o.n)).size;
    if (c.since > 45 || recentDays < 2 || (c.gap >= 3 && c.since > Math.max(c.gap * R.lateFactor, c.gap + 7))) continue;
    for (const [prod, g] of (CP.get(c.cust) || new Map())) {
      if (g.ordersBefore.size < 2 || T - g.lastN <= R.dropQuiet) continue;
      dropped.push({ lastOrder: c.last, recentOrders: recentDays, dates: [...g.days].sort((a, b) => a - b).slice(-8).map(iso), cust: c.cust, rep: c.rep, prod, last: iso(g.lastN), since: T - g.lastN, times: g.ordersBefore.size, value: r0(g.vQuietBefore / ((R.window - R.dropQuiet) / R.dropQuiet)) });
    }
  }

  // ---- 5. ordered but not invoiced
  const lineTI = new Map(); let hasLineTI = false;
  for (const l of lines) if (l.toInv !== null && l.toInv !== undefined) { hasLineTI = true; lineTI.set(l.oid, (lineTI.get(l.oid) || 0) + n0(l.toInv)); }
  const uninv = O.filter((o) => o.age >= R.uninvoicedAfter).map((o) => ({ order: o.name, cust: o.cust, rep: o.rep, date: o.d, age: o.age, value: r0(hasLineTI ? (lineTI.get(o.id) || 0) : (o.toInv ? o.net : 0)) })).filter((x) => x.value > 0);

  // ---- 6. overdue invoices (cash, kept apart from the sales opportunities)
  const od = (unpaid || []).filter((u) => u.amt > 0 && u.due && dnum(u.due) < T).map((u) => ({ name: u.name, cust: u.cust, rep: u.rep || (C.get(u.cust) || {}).rep || 'No salesperson', due: u.due, late: T - dnum(u.due), value: r0(u.amt) }));

  // ---- 7. when orders arrive (week of the month x weekday, week starts Saturday)
  const grid = Array.from({ length: 5 }, () => Array(7).fill(0)), dayTot = Array(7).fill(0); let net = 0, monthEnd = 0, firstWeek = 0;
  for (const o of O) {
    const d = new Date(o.n * DAY), dom = d.getUTCDate(), wd = (d.getUTCDay() + 1) % 7, ld = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    grid[Math.min(4, Math.floor((dom - 1) / 7))][wd] += o.net; dayTot[wd] += o.net; net += o.net;
    if (dom > ld - 7) monthEnd += o.net; if (dom <= 7) firstWeek += o.net;
  }
  const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'], bestI = dayTot.indexOf(Math.max(...dayTot)), worst = dayTot.map((v, i) => [v, i]).filter(([, i]) => i !== 6).sort((a, b) => a[0] - b[0])[0];
  // per day and salesperson totals: small, and enough for the page to re-cut the grid for any salesperson and date range
  const tReps = [...new Set(O.map((o) => o.rep))].sort(), tIdx = new Map(tReps.map((r, i) => [r, i])), tMap = new Map();
  for (const o of O) { const k = o.n + '|' + tIdx.get(o.rep); tMap.set(k, (tMap.get(k) || 0) + o.net); }
  const tRows = [...tMap.entries()].map(([k, v]) => { const [n, i] = k.split('|'); return [Number(n), Number(i), Math.round(v)]; });
  const timing = { reps: tReps, rows: tRows, days: DAYS, grid: grid.map((r) => r.map(r0)), max: r0(Math.max(1, ...grid.flat())), monthEndShare: net ? r0((monthEnd / net) * 100) : 0, firstWeekShare: net ? r0((firstWeek / net) * 100) : 0, bestDay: DAYS[bestI], bestShare: net ? r0((dayTot[bestI] / net) * 100) : 0, quietDay: worst ? DAYS[worst[1]] : '', total: r0(net) };

  // ---- 8. cities
  const K = new Map();
  for (const o of O) {
    const k = K.get(o.city) || { name: o.city, sales: 0, last90: 0, prior90: 0, cust: new Map() };
    k.sales += o.net; if (o.age <= R.recent) k.last90 += o.net; else if (o.age <= R.recent * 2) k.prior90 += o.net;
    if (o.age <= R.active) k.cust.set(o.cust, (k.cust.get(o.cust) || 0) + o.net); K.set(o.city, k);
  }
  const cities = top([...K.values()].map((k) => { const cs = [...k.cust.entries()].sort((a, b) => b[1] - a[1]), tot = cs.reduce((a, x) => a + x[1], 0);
    return { name: k.name, sales: r0(k.sales), last90: r0(k.last90), prior90: r0(k.prior90), change: k.prior90 > 0 ? r0((k.last90 / k.prior90 - 1) * 100) : null, dists: cs.length, top: cs[0] ? cs[0][0] : '', topShare: tot ? r0((cs[0][1] / tot) * 100) : 0 }; }), 16, 'sales');

  const repSales = new Map(); for (const o of O) repSales.set(o.rep, (repSales.get(o.rep) || 0) + o.net);
  return {
    asOf: today, from: iso(T - R.window), rules: R,
    counts: { distributors: all.length, active: active.length, activeNow: active.length, orders: O.length, sales: r0(net) },
    reps: [...repSales.entries()].sort((a, b) => b[1] - a[1]).map(([name, sales]) => ({ name, sales: r0(sales) })).slice(0, 60),
    reorder: top(reorder, 150), shrink: top(shrink, 80),
    white: { products: core.map((p) => ({ name: p.name, pen: r0(p.pen), buyers: p.buyers })), rows: rowsM, gaps: top(whiteGaps, 250), active: active.length },
    dropped: top(dropped, 200), uninv: top(uninv, 200), uninvExact: hasLineTI,
    unpaid: unpaid ? top(od, 200) : null, timing, cities,
  };
}

/** Reads Odoo and runs the analysis. */
export async function buildGrowth(cfg, today) {
  const T = dnum(today), start = iso(T - RULES.window), notes = [];
  let meta = {}; try { meta = await call(cfg, 'sale.order', 'fields_get', [], { attributes: ['string', 'type', 'relation'] }); } catch (err) { /* user_id below */ }
  // Same rule as the Salespeople tab: a field that names the real person wins over Odoo's Salesperson login.
  const repFields = Object.entries(meta).filter(([k, f]) => ['many2one', 'char', 'selection'].includes(f.type) && f.relation !== 'crm.team' && (k === 'user_id' || /sales\s*-?\s*(person|rep|man|agent)/i.test(String(f.string)))).map(([k]) => k);
  if (!repFields.length) repFields.push('user_id');
  const lf = await fieldsOf(cfg, 'sale.order.line').catch(() => null), hasTI = !!(lf && lf.has('untaxed_amount_to_invoice'));
  const dom = [['state', 'in', ['sale', 'done']], ['date_order', '>=', start + ' 00:00:00']];
  const [ro, rl, ru] = await Promise.all([
    sr(cfg, 'sale.order', dom, ['name', 'partner_id', 'partner_shipping_id', ...repFields, 'amount_untaxed', 'date_order', 'invoice_status'], { app: 'Sales', limit: 40000 }),
    sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', start + ' 00:00:00']], ['order_id', 'product_id', 'product_uom_qty', 'price_subtotal', 'untaxed_amount_to_invoice'], { app: 'Sales', limit: 80000 }),
    sr(cfg, 'account.move', [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']], ['invoice_date_due', '<', today]], ['name', 'partner_id', 'invoice_user_id', 'invoice_origin', 'invoice_date_due', 'amount_residual_signed', 'amount_residual'], { app: 'Accounting', limit: 8000 })
      .catch((e) => { notes.push('Overdue invoices could not be read: ' + String(e.message || e).slice(0, 160)); return null; }),
  ]);
  // Partners: count a company's contacts under the company, and find the city.
  const pids = [...new Set([...ro.flatMap((o) => [nid(o.partner_shipping_id), nid(o.partner_id)]), ...(ru || []).map((m) => nid(m.partner_id))].filter(Boolean))], part = new Map();
  for (let i = 0; i < pids.length; i += 500) {
    try { for (const g of await call(cfg, 'res.partner', 'read', [pids.slice(i, i + 500), ['commercial_partner_id', 'city', 'state_id']])) part.set(g.id, { co: nm(g.commercial_partner_id), city: (g.city || '').trim() || nm(g.state_id) || '' }); } catch (err) { break; }
  }
  const custOf = (p) => (part.get(nid(p)) || {}).co || nm(p) || 'Unknown';
  const cityOf = (o) => (part.get(nid(o.partner_shipping_id)) || {}).city || (part.get(nid(o.partner_id)) || {}).city || 'Unknown';
  const val = (o, f) => { const v = o[f]; return Array.isArray(v) ? nm(v) : typeof v === 'string' ? v.trim() : ''; };
  const filled = Object.fromEntries(repFields.map((f) => [f, ro.filter((o) => val(o, f)).length])), order = [...repFields].sort((a, b) => (a === 'user_id') - (b === 'user_id') || filled[b] - filled[a]);
  const who = (o) => { for (const f of order) if (val(o, f)) return val(o, f); return 'No salesperson'; };
  const orders = ro.map((o) => ({ id: o.id, name: o.name, d: String(o.date_order).slice(0, 10), cust: custOf(o.partner_id), city: cityOf(o), rep: who(o), net: n0(o.amount_untaxed), toInv: o.invoice_status === 'to invoice' }));
  // Delivery fees and other services are not products a salesperson can "offer", so leave them out of the product findings.
  const prodIds = [...new Set(rl.map((l) => nid(l.product_id)).filter(Boolean))], service = new Set();
  for (let i = 0; i < prodIds.length; i += 500) {
    try { for (const g of await call(cfg, 'product.product', 'read', [prodIds.slice(i, i + 500), ['type']])) if (g.type === 'service') service.add(g.id); } catch (err) { break; }
  }
  const lines = rl.map((l) => ({ oid: nid(l.order_id), prod: service.has(nid(l.product_id)) ? '' : nm(l.product_id), qty: n0(l.product_uom_qty), v: n0(l.price_subtotal), toInv: hasTI && typeof l.untaxed_amount_to_invoice === 'number' ? l.untaxed_amount_to_invoice : null }));
  const repByOrder = new Map(orders.map((o) => [o.name, o.rep]));
  const unpaid = ru && ru.map((m) => ({ name: m.name, cust: custOf(m.partner_id), rep: String(m.invoice_origin || '').split(/[,\s]+/).map((x) => repByOrder.get(x)).find(Boolean) || '', due: m.invoice_date_due, amt: Math.abs(n0(typeof m.amount_residual_signed === 'number' ? m.amount_residual_signed : m.amount_residual)) }));
  if (ro.length >= 40000) notes.push('There are more than 40,000 orders in 12 months, so only the first 40,000 were read.');
  return { ...analyse({ orders, lines, unpaid, today }), notes };
}

export function growthSections(cfg, ctx, { section }) {
  return [section('growth', 'Growth radar', 'growth', () => buildGrowth(cfg, ctx.today))];
}
