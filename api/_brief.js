import { call, sr, nm, nid, fieldsOf } from './_odoo.js';

/**
 * Executive brief: one page that reads sales, salespeople, distributors, suppliers, the P&L and the balance sheet
 * together and turns them into a ranked list of actions, each with the money attached to it.
 * Every data source is optional: if one Odoo app is missing, its part is left out and named in "gaps".
 */
const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const day = (v) => String(v || '').slice(0, 10);
const clamp = (v) => Math.max(0, Math.min(1, v));
const r1 = (v) => Math.round(v * 10) / 10;
const QUIET_DAYS = 45, LOST_DAYS = 90, SUPPLY_DAYS = 180;
const pad2 = (n) => String(n).padStart(2, '0');
const monthAdd = (ym, n) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); };
const monthLabel = (ym) => new Date(ym + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const daysIn = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const bare = (n) => String(n || '').replace(/^\s*\[[^\]]*\]\s*/, '');

/** Account type (Odoo 16+ "asset_cash", older "Bank and Cash") to one of our classes. */
export function accountClass(type) {
  const x = String(type || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (!x || /off balance/.test(x)) return 'other';
  if (/cost of revenue|direct cost/.test(x)) return 'cogs';
  if (/expense|depreciation/.test(x)) return 'expense';
  if (/income|revenue/.test(x)) return 'income';
  if (/receivable/.test(x)) return 'recv';
  if (/payable/.test(x)) return 'payable';
  if (/credit card/.test(x)) return 'cur_liab';
  if (/cash|bank/.test(x)) return 'cash';
  if (/liabilit/.test(x)) return /non current/.test(x) ? 'long_liab' : 'cur_liab';
  if (/equity|earnings/.test(x)) return 'equity';
  if (/asset|prepay/.test(x)) return /non current|fixed/.test(x) ? 'fixed_asset' : 'cur_asset';
  return 'other';
}

export function briefSections(cfg, ctx, h) {
  const { section, tile, bd, COL, costsOf, daily, sum, pct, n0, dt, dtEnd } = h;
  const { s, e, ps, pe, today } = ctx;
  const cur3 = ctx.currency || '';
  const M = (v) => (v < 0 ? '-' : '') + (cur3 ? cur3 + ' ' : '') + Math.abs(Math.round(v)).toLocaleString('en-US');
  const days = between(s, e) + 1;
  // 13 months of orders: 12 to show, one more so the first month shown knows who is new and who came back.
  const months13 = Array.from({ length: 13 }, (_, i) => monthAdd(e.slice(0, 7), i - 12)), months12 = months13.slice(1);
  const lookStart = [ps, months13[0] + '-01'].sort()[0], supplyStart = addDays(e, -SUPPLY_DAYS);
  const memo = {}, gaps = [];
  const once = (k, fn) => (memo[k] = memo[k] || fn());
  const soft = (k, what, fn, dflt) => once(k, async () => { try { return await fn(); } catch (err) { gaps.push(what + ': ' + String(err.message || err).slice(0, 160)); return dflt; } });
  const inR = (d, a, b) => d >= a && d <= b;

  // A company's contacts are counted under the company.
  const company = new Map();
  const learn = async (ids) => {
    const need = [...new Set(ids.filter((i) => i && !company.has(i)))];
    for (let i = 0; i < need.length; i += 500) {
      try { for (const g of await call(cfg, 'res.partner', 'read', [need.slice(i, i + 500), ['commercial_partner_id']])) company.set(g.id, nm(g.commercial_partner_id)); } catch (err) { break; }
    }
  };
  const custOf = (p) => company.get(nid(p)) || nm(p) || 'Unknown';

  const orders = () => soft('orders', 'Sales orders', async () => {
    let meta = {}; try { meta = await call(cfg, 'sale.order', 'fields_get', [], { attributes: ['string', 'type', 'relation'] }); } catch (err) { /* user_id below */ }
    // Same rule as the Salespeople tab: a field that names the real person wins over Odoo's Salesperson login.
    const repFields = Object.entries(meta).filter(([k, f]) => ['many2one', 'char', 'selection'].includes(f.type) && f.relation !== 'crm.team' && (k === 'user_id' || /sales\s*-?\s*(person|rep|man|agent)/i.test(String(f.string)))).map(([k]) => k);
    if (!repFields.length) repFields.push('user_id');
    const list = await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(lookStart)], ['date_order', '<=', dtEnd(e)]], ['name', 'partner_id', ...repFields, 'amount_untaxed', 'amount_total', 'date_order'], { app: 'Sales', limit: 40000 });
    const val = (o, f) => { const v = o[f]; return Array.isArray(v) ? nm(v) : typeof v === 'string' ? v.trim() : ''; };
    const filled = Object.fromEntries(repFields.map((f) => [f, list.filter((o) => val(o, f)).length]));
    const order = [...repFields].sort((a, b) => (a === 'user_id') - (b === 'user_id') || filled[b] - filled[a]);
    const who = (o) => { for (const f of order) if (val(o, f)) return val(o, f); return 'No salesperson'; };
    await learn(list.map((o) => nid(o.partner_id)));
    return list.map((o) => ({ name: o.name, d: day(o.date_order), ym: day(o.date_order).slice(0, 7), cust: custOf(o.partner_id), rep: who(o), net: n0(o.amount_untaxed), gross: n0(o.amount_total) }));
  }, []);

  const linesOf = (k, a, b) => soft(k, 'Products sold', async () => {
    const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(a)], ['order_id.date_order', '<=', dtEnd(b)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 40000 });
    const m = new Map();
    for (const l of list) { const k = nid(l.product_id); if (!k) continue; const g = m.get(k) || { pid: k, name: nm(l.product_id), rev: 0, units: 0 }; g.rev += n0(l.price_subtotal); g.units += n0(l.product_uom_qty); m.set(k, g); }
    const arr = [...m.values()].sort((a, b) => b.rev - a.rev);
    const costs = await costsOf(cfg, arr.map((g) => g.pid));
    for (const g of arr) { const c = costs.get(g.pid); g.unit = c > 0 ? c : null; g.cost = g.unit !== null ? g.unit * g.units : null; g.profit = g.cost !== null ? g.rev - g.cost : null; g.margin = g.cost !== null && g.rev ? pct(g.rev - g.cost, g.rev) : null; }
    return arr;
  }, []);
  const lines = () => linesOf('lines', s, e), linesPrev = () => linesOf('linesPrev', ps, pe);

  const resid = (m) => Math.abs(n0(m.amount_residual_signed ?? m.amount_residual));
  const openMoves = (type) => sr(cfg, 'account.move', [['move_type', '=', type], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]], ['name', 'partner_id', 'invoice_user_id', 'invoice_date', 'invoice_date_due', 'amount_residual_signed', 'amount_residual'], { app: 'Accounting', limit: 20000 });
  const lateBy = (due) => (due && due < today ? between(due, today) : 0);
  const recv = () => soft('recv', 'Customer invoices', async () => {
    const list = await openMoves('out_invoice');
    await learn(list.map((m) => nid(m.partner_id)));
    return list.map((m) => ({ name: m.name, cust: custOf(m.partner_id), rep: nm(m.invoice_user_id), date: m.invoice_date || '–', due: m.invoice_date_due || '', owed: resid(m), late: lateBy(m.invoice_date_due) })).filter((r) => r.owed > 0.5);
  }, []);
  const pay = () => soft('pay', 'Supplier bills', async () => (await openMoves('in_invoice')).map((m) => ({ name: m.name, sup: nm(m.partner_id) || 'Unknown', due: m.invoice_date_due || '', owed: resid(m), late: lateBy(m.invoice_date_due) })).filter((r) => r.owed > 0.5), []);

  const po = () => soft('po', 'Purchase orders', async () => (await sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']], ['date_order', '>=', dt(supplyStart)], ['date_order', '<=', dtEnd(e)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Purchase', limit: 20000 }))
    .map((o) => ({ id: o.id, name: o.name, sup: nm(o.partner_id) || 'Unknown', d: day(o.date_order), amount: n0(o.amount_total) })), []);
  // Did what you buy get dearer? The last 90 days against the 90 before, item by item.
  const buyPrices = () => soft('buyPrices', 'Purchase prices', async () => {
    const PO = await po(); if (!PO.length) return [];
    const by = new Map(PO.map((o) => [o.id, o])), mid = addDays(e, -SUPPLY_DAYS / 2);
    const list = await sr(cfg, 'purchase.order.line', [['order_id.state', 'in', ['purchase', 'done']], ['order_id.date_order', '>=', dt(supplyStart)], ['order_id.date_order', '<=', dtEnd(e)]], ['order_id', 'product_id', 'product_qty', 'price_unit'], { app: 'Purchase', limit: 40000 });
    const m = new Map();
    for (const l of list) { const o = by.get(nid(l.order_id)), k = nid(l.product_id), q = n0(l.product_qty), pr = n0(l.price_unit); if (!o || !k || q <= 0 || pr <= 0) continue; const g = m.get(k) || { name: nm(l.product_id), oq: 0, ov: 0, nq: 0, nv: 0, sup: o.sup, last: '' }; if (o.d > mid) { g.nq += q; g.nv += q * pr; } else { g.oq += q; g.ov += q * pr; } if (o.d >= g.last) { g.last = o.d; g.sup = o.sup; } m.set(k, g); }
    return [...m.values()].filter((g) => g.oq > 0 && g.nq > 0).map((g) => { const was = g.ov / g.oq, now = g.nv / g.nq; return { name: g.name, sup: g.sup, was, now, chg: r1(((now - was) / was) * 100), extra: (now - was) * g.nq, qty: g.nq }; }).filter((r) => Math.abs(r.chg) >= 3).sort((a, b) => b.extra - a.extra);
  }, []);

  const stock = () => soft('stock', 'Stock levels', async () => {
    const L = (await lines()).slice(0, 80), out = new Map();
    if (!L.length) return out;
    const have = await fieldsOf(cfg, 'product.product'); if (!have || !have.has('qty_available')) return out;
    const f = ['qty_available', ...(have.has('is_storable') ? ['is_storable'] : []), ...(have.has('type') ? ['type'] : [])];
    for (const g of await call(cfg, 'product.product', 'read', [L.map((l) => l.pid), f], { context: { lang: 'en_US' } })) out.set(g.id, { qty: n0(g.qty_available), storable: have.has('is_storable') ? !!g.is_storable : g.type === 'product' });
    return out;
  }, new Map());

  const fin = () => soft('fin', 'Accounting', async () => {
    const have = await fieldsOf(cfg, 'account.account');
    if (!have || !(await fieldsOf(cfg, 'account.move.line'))) throw new Error('the Accounting app is not installed');
    const tf = have.has('account_type') ? 'account_type' : 'user_type_id';
    const accs = await sr(cfg, 'account.account', [], ['code', 'name', tf], { app: 'Accounting', limit: 8000 });
    const info = new Map(accs.map((a) => { const cls = accountClass(Array.isArray(a[tf]) ? a[tf][1] : a[tf]); return [a.id, { code: String(a.code || ''), name: a.name || '', cls, inv: cls === 'cur_asset' && /stock|inventor|goods|مخزون|بضاع/i.test(a.name || '') }]; }));
    const grp = async (extra) => {
      const r = await call(cfg, 'account.move.line', 'read_group', [[['parent_state', '=', 'posted'], ...extra], ['debit:sum', 'credit:sum'], ['account_id']], { lazy: false, context: { lang: 'en_US' } });
      const m = new Map();
      for (const g of r || []) { const id = nid(g.account_id); if (id) m.set(id, (m.get(id) || 0) + n0(g.debit) - n0(g.credit)); }
      return m;
    };
    const [now, prev, bal, balP] = await Promise.all([grp([['date', '>=', s], ['date', '<=', e]]), grp([['date', '>=', ps], ['date', '<=', pe]]), grp([['date', '<=', e]]), grp([['date', '<=', pe]])]);
    // month by month, for the 12-month profit trend
    let monthly = null;
    try {
      const r = await call(cfg, 'account.move.line', 'read_group', [[['parent_state', '=', 'posted'], ['date', '>=', months12[0] + '-01'], ['date', '<=', e]], ['debit:sum', 'credit:sum'], ['account_id', 'date:month']], { lazy: false, context: { lang: 'en_US' } });
      const by = new Map(months12.map((k) => [k, { I: 0, C: 0, X: 0 }])); let hit = 0;
      for (const g of r || []) {
        const rg = g.__range && g.__range['date:month'], lab = g['date:month'];
        let k = rg && rg.from ? String(rg.from).slice(0, 7) : ''; if (!k && lab) { const d = Date.parse('1 ' + lab + ' UTC'); if (!Number.isNaN(d)) k = new Date(d).toISOString().slice(0, 7); }
        const row = by.get(k), c = (info.get(nid(g.account_id)) || {}).cls, v = n0(g.debit) - n0(g.credit); if (!row) continue; hit++;
        if (c === 'income') row.I -= v; else if (c === 'cogs') row.C += v; else if (c === 'expense') row.X += v;
      }
      if (hit) monthly = months12.map((k) => ({ key: k, label: monthLabel(k), ...by.get(k) }));
    } catch (err) { /* the trend is an extra */ }
    const tot = (m, c, sign) => { let t = 0; for (const [id, v] of m) if ((info.get(id) || {}).cls === c) t += v * sign; return t; };
    const I = tot(now, 'income', -1), C = tot(now, 'cogs', 1), X = tot(now, 'expense', 1), pI = tot(prev, 'income', -1), pC = tot(prev, 'cogs', 1), pX = tot(prev, 'expense', 1);
    const accRows = (c, sign) => [...new Set([...now.keys(), ...prev.keys()])].filter((id) => (info.get(id) || {}).cls === c)
      .map((id) => ({ code: info.get(id).code, name: info.get(id).name, now: (now.get(id) || 0) * sign, prev: (prev.get(id) || 0) * sign })).map((r) => ({ ...r, diff: r.now - r.prev })).sort((a, b) => b.now - a.now);
    const sheet = (m) => {
      const B = (c, sign) => tot(m, c, sign); let inv = 0; for (const [id, v] of m) if ((info.get(id) || {}).inv) inv += v;
      const profitToDate = B('income', -1) - B('cogs', 1) - B('expense', 1);
      const cash = B('cash', 1), recvB = B('recv', 1), curA = B('cur_asset', 1), fixedA = B('fixed_asset', 1), payB = B('payable', -1), curL = B('cur_liab', -1), longL = B('long_liab', -1), eq = B('equity', -1) + profitToDate, other = B('other', 1);
      return { cash, recvB, curA, inv, fixedA, A: cash + recvB + curA + fixedA, payB, curL, longL, L: payB + curL + longL, eq, other };
    };
    return { I, C, X, gross: I - C, net: I - C - X, pI, pC, pX, pGross: pI - pC, pNet: pI - pC - pX, expRows: accRows('expense', 1), cogsRows: accRows('cogs', 1), monthly, ...sheet(bal), was: sheet(balP) };
  }, null);

  /* ---------- the model every card reads from ---------- */
  const model = () => once('model', async () => {
    const [O, L, LP, R, P, PO, F, ST, BP] = await Promise.all([orders(), lines(), linesPrev(), recv(), pay(), po(), fin(), stock(), buyPrices()]);
    const cur = O.filter((o) => inR(o.d, s, e)), prev = O.filter((o) => inR(o.d, ps, pe));
    const sales = sum(cur, 'net'), salesPrev = sum(prev, 'net'), salesGross = sum(cur, 'gross');
    const growth = salesPrev ? r1(((sales - salesPrev) / Math.abs(salesPrev)) * 100) : null;

    // every customer over the 13 months
    const cm = new Map();
    for (const o of O) { const g = cm.get(o.cust) || { name: o.cust, first: o.d, last: o.d, n: 0, total: 0, cur: 0, prev: 0, rep: o.rep, prevRep: '' }; if (o.d < g.first) g.first = o.d; if (o.d >= g.last) { g.last = o.d; g.rep = o.rep; } g.n++; g.total += o.net; if (inR(o.d, s, e)) g.cur += o.net; if (inR(o.d, ps, pe)) { g.prev += o.net; g.prevRep = o.rep; } cm.set(o.cust, g); }
    const custs = [...cm.values()], repOfCust = new Map(custs.map((c) => [c.name, c.rep]));
    const curSet = new Set(cur.map((o) => o.cust)), prevSet = new Set(prev.map((o) => o.cust));
    const active = custs.filter((c) => curSet.has(c.name)), fresh = active.filter((c) => c.first >= s);
    const quiet = custs.filter((c) => c.n >= 2 && between(c.last, e) >= QUIET_DAYS).map((c) => ({ name: c.name, monthly: c.total / Math.max(1, between(c.first, e) / 30), silent: between(c.last, e), last: c.last, orders: c.n, rep: c.rep })).sort((a, b) => b.monthly - a.monthly);
    const byCur = active.slice().sort((a, b) => b.cur - a.cur);
    const topShare = sales > 0 && byCur.length ? pct(byCur[0].cur, sales) : 0, top3Share = sales > 0 ? pct(sum(byCur.slice(0, 3), 'cur'), sales) : 0;
    const retained = [...prevSet].filter((c) => curSet.has(c)).length, retention = prevSet.size ? pct(retained, prevSet.size) : null;

    // why sales moved: customer by customer
    const B = { fresh: [], back: [], up: [], down: [], gone: [] };
    for (const c of custs) { if (!c.cur && !c.prev) continue; const row = { name: c.name, value: c.cur - c.prev, cur: c.cur, prev: c.prev, rep: c.rep };
      if (c.prev <= 0 && c.cur > 0) (c.first >= s ? B.fresh : B.back).push(row); else if (c.prev > 0 && c.cur <= 0) B.gone.push(row); else if (c.cur >= c.prev) B.up.push(row); else B.down.push(row); }
    for (const k of Object.keys(B)) B[k].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    // why sales moved: price against volume, product by product
    const pm = new Map(LP.map((l) => [l.pid, l])), cmP = new Map(L.map((l) => [l.pid, l]));
    const pv = { price: 0, volume: 0, added: 0, dropped: 0, rows: [], cur: sum(L, 'rev'), prev: sum(LP, 'rev') };
    for (const l of L) { const p = pm.get(l.pid);
      if (!p || p.units <= 0 || l.units <= 0) { pv.added += l.rev - (p ? p.rev : 0); pv.rows.push({ pid: l.pid, name: l.name, kind: 'New', priceFx: null, volFx: null, total: l.rev - (p ? p.rev : 0), priceChg: null, volChg: null }); continue; }
      const pc = l.rev / l.units, pp = p.rev / p.units, priceFx = (pc - pp) * l.units, volFx = (l.units - p.units) * pp;
      pv.price += priceFx; pv.volume += volFx; pv.rows.push({ pid: l.pid, name: l.name, kind: 'Both periods', priceFx, volFx, total: priceFx + volFx, priceChg: pp ? r1(((pc - pp) / pp) * 100) : null, volChg: r1(((l.units - p.units) / p.units) * 100) }); }
    for (const p of LP) if (!cmP.has(p.pid)) { pv.dropped -= p.rev; pv.rows.push({ pid: p.pid, name: p.name, kind: 'Not sold now', priceFx: null, volFx: null, total: -p.rev, priceChg: null, volChg: -100 }); }
    pv.rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    // 12 months
    const mo = new Map(months13.map((k) => [k, { sales: 0, orders: 0, set: new Set() }]));
    for (const o of O) { const g = mo.get(o.ym); if (g) { g.sales += o.net; g.orders++; g.set.add(o.cust); } }
    const firstYm = new Map(custs.map((c) => [c.name, c.first.slice(0, 7)]));
    const monthly = months12.map((k, i) => { const g = mo.get(k), before = mo.get(months13[i]).set; let fresh12 = 0, again = 0; for (const c of g.set) { if (firstYm.get(c) === k) fresh12++; if (before.has(c)) again++; }
      return { key: k, label: monthLabel(k), values: { sales: g.sales, orders: g.orders, customers: g.set.size, fresh: fresh12, avg: g.orders ? g.sales / g.orders : 0, repeat: before.size ? pct(again, before.size) : 0 } }; });

    // where the month will land
    let fc = null;
    const ym = e.slice(0, 7), dim = daysIn(ym);
    if (s === ym + '-01' && today.slice(0, 7) === ym && e >= addDays(today, -1) && days < dim && sales > 0) {
      const lm = monthAdd(ym, -1), lmO = O.filter((o) => o.ym === lm), lmTotal = sum(lmO, 'net'), lmToDate = sum(lmO.filter((o) => Number(o.d.slice(8, 10)) <= days), 'net');
      const a = (sales / days) * dim, share = lmTotal > 0 ? lmToDate / lmTotal : 0, b = share > 0.05 ? sales / share : a;
      fc = { low: Math.min(a, b), high: Math.max(a, b), mid: (a + b) / 2, last: lmTotal, left: dim - days, perDay: sales / days, need: lmTotal > sales ? (lmTotal - sales) / (dim - days) : 0, lastLabel: monthLabel(lm) };
    }

    // segments: how recently, how often, how much
    const ranked = custs.slice().sort((a, b) => b.total - a.total), topCut = ranked.length ? ranked[Math.max(0, Math.ceil(ranked.length * 0.2) - 1)].total : 0;
    const SEG = [['New', 'First order in the last 60 days. Call after delivery and secure the second order.'], ['Champions', 'Recent, frequent and big. Protect them: priority stock, early offers, a named contact.'], ['Loyal', 'Order regularly. Grow the basket with products they do not buy yet.'], ['Occasional', 'Bought recently but rarely. Offer a reason to order monthly.'], ['At risk', `Silent ${QUIET_DAYS} to ${LOST_DAYS} days. Call this week before they are gone.`], ['Lost', `No order for more than ${LOST_DAYS} days. One win-back offer, then stop spending time.`]];
    const segOf = (c) => { const r = between(c.last, e); if (r > LOST_DAYS) return 'Lost'; if (r >= QUIET_DAYS) return 'At risk'; if (between(c.first, e) <= 60) return 'New'; if (r <= 30 && c.n >= 4 && c.total >= topCut) return 'Champions'; if (c.n >= 3) return 'Loyal'; return 'Occasional'; };
    const total12 = sum(custs, 'total'), segs = SEG.map(([name, todo]) => { const list = custs.filter((c) => segOf(c) === name).sort((a, b) => b.total - a.total); return { name, todo, list, customers: list.length, value: sum(list, 'total'), share: total12 ? pct(sum(list, 'total'), total12) : 0, orders: sum(list, 'n') }; });

    // ABC: who makes the first 80% of sales
    const abc = (list, key, what) => { const tot = sum(list, key); let run = 0; const cls = { A: [0, 0], B: [0, 0], C: [0, 0] }; for (const x of list.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key])) { const c = run < tot * 0.8 ? 'A' : run < tot * 0.95 ? 'B' : 'C'; run += x[key]; cls[c][0]++; cls[c][1] += x[key]; }
      const n = cls.A[0] + cls.B[0] + cls.C[0]; return [['A', 'first 80% of sales'], ['B', 'next 15%'], ['C', 'last 5%']].map(([c, l]) => ({ name: `${what} · class ${c}`, what: l, count: cls[c][0], ofAll: n ? pct(cls[c][0], n) : 0, sales: cls[c][1], share: tot ? pct(cls[c][1], tot) : 0 })); };
    const abcRows = [...abc(active, 'cur', 'Customers'), ...abc(L, 'rev', 'Products')];

    // receivables
    const owedTotal = sum(R, 'owed'), overdueList = R.filter((r) => r.late > 0), overdueTotal = sum(overdueList, 'owed');
    const dm = new Map();
    for (const r of R) { const g = dm.get(r.cust) || { name: r.cust, overdue: 0, owed: 0, oldest: 0, invoices: 0, rep: repOfCust.get(r.cust) || r.rep || '–', list: [] }; g.owed += r.owed; g.invoices++; if (r.late > 0) { g.overdue += r.owed; g.oldest = Math.max(g.oldest, r.late); } g.list.push(r); dm.set(r.cust, g); }
    const debtors = [...dm.values()].filter((g) => g.overdue > 0.5).sort((a, b) => b.overdue - a.overdue);
    const dso = salesGross > 0 ? owedTotal / (salesGross / days) : null;
    const aging = [['Not due yet', -1, 0], ['1 to 30 days late', 0, 30], ['31 to 60 days late', 30, 60], ['61 to 90 days late', 60, 90], ['Over 90 days late', 90, Infinity]].map(([name, lo, hi]) => { const list = R.filter((r) => r.late > lo && r.late <= hi); return { name, value: sum(list, 'owed'), invoices: list.length, customers: new Set(list.map((r) => r.cust)).size, share: owedTotal ? pct(sum(list, 'owed'), owedTotal) : 0 }; });
    const stale = sum(R.filter((r) => r.late > 60), 'owed');

    // salespeople
    const rm = new Map();
    const rep = (k) => { if (!rm.has(k)) rm.set(k, { name: k, sales: 0, prev: 0, orders: 0, custs: new Map(), prevCusts: new Set(), overdue: 0 }); return rm.get(k); };
    for (const o of cur) { const g = rep(o.rep); g.sales += o.net; g.orders++; g.custs.set(o.cust, (g.custs.get(o.cust) || 0) + o.net); }
    for (const o of prev) { const g = rep(o.rep); g.prev += o.net; g.prevCusts.add(o.cust); }
    for (const d of debtors) if (rm.has(d.rep)) rm.get(d.rep).overdue += d.overdue;
    const reps = [...rm.values()].map((g) => { const top = [...g.custs].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value), kept = [...g.prevCusts].filter((c) => curSet.has(c)).length;
      return { name: g.name, sales: g.sales, prev: g.prev, growth: g.prev ? r1(((g.sales - g.prev) / Math.abs(g.prev)) * 100) : null, orders: g.orders, customers: g.custs.size, avg: g.orders ? g.sales / g.orders : 0, share: sales ? pct(g.sales, sales) : 0, overdue: g.overdue,
        won: top.filter((c) => (cm.get(c.name) || {}).first >= s).length, lost: g.prevCusts.size - kept, keep: g.prevCusts.size ? pct(kept, g.prevCusts.size) : null, lean: g.sales > 0 && top.length ? pct(top[0].value, g.sales) : null, top }; }).sort((a, b) => b.sales - a.sales);
    const falling = reps.filter((r) => r.name !== 'No salesperson' && r.prev >= salesPrev * 0.05 && r.prev > 0 && r.growth !== null && r.growth <= -20).map((r) => ({ ...r, gap: r.prev - r.sales })).sort((a, b) => b.gap - a.gap);
    const unassigned = reps.find((r) => r.name === 'No salesperson');

    // payables and suppliers
    const payTotal = sum(P, 'owed'), payLate = sum(P.filter((p) => p.late > 0), 'owed'), week = addDays(today, 7), paySoon = sum(P.filter((p) => !p.late && p.due && p.due <= week), 'owed');
    const sm = new Map();
    for (const o of PO) { const g = sm.get(o.sup) || { name: o.sup, amount: 0, orders: 0, cur: 0, owed: 0 }; g.amount += o.amount; g.orders++; if (inR(o.d, s, e)) g.cur += o.amount; sm.set(o.sup, g); }
    for (const p of P) if (sm.has(p.sup)) sm.get(p.sup).owed += p.owed;
    const bought = sum(PO, 'amount'), suppliers = [...sm.values()].map((g) => ({ ...g, share: bought ? pct(g.amount, bought) : 0 })).sort((a, b) => b.amount - a.amount);
    const dearer = BP.filter((r) => r.extra > 0), dearerCost = sum(dearer, 'extra');

    // margin and stock
    const known = L.filter((l) => l.cost !== null && l.rev > 0), knownRev = sum(known, 'rev'), knownCost = sum(known, 'cost'), allRev = sum(L, 'rev');
    const gm = knownRev ? pct(knownRev - knownCost, knownRev) : null;
    const unknown = L.filter((l) => l.cost === null && l.rev > 0), unknownRev = sum(unknown, 'rev');
    const leaks = gm === null ? [] : known.filter((l) => l.margin < 0 || (l.rev >= allRev * 0.01 && l.margin < gm - 8)).map((l) => ({ pid: l.pid, name: l.name, gain: (l.rev * (gm - l.margin)) / 100, margin: l.margin, rev: l.rev, unit: l.unit, units: l.units })).sort((a, b) => b.gain - a.gain);
    const cover = L.map((l) => { const x = ST.get(l.pid); if (!x || !x.storable || l.units <= 0) return null; const perDay = l.units / days; return { pid: l.pid, name: l.name, qty: x.qty, perDay, cover: x.qty <= 0 ? 0 : x.qty / perDay, rev: l.rev, units: l.units, week: (l.rev / days) * 7, unitsWeek: perDay * 7 }; }).filter(Boolean);
    const outs = cover.filter((c) => c.qty <= 0), thin = cover.filter((c) => c.qty > 0 && c.cover < 14).sort((a, b) => a.cover - b.cover);

    // ratios, from the books
    let ratios = [];
    if (F) {
      const yr = 365 / days, W = F.was, st = (v, good, ok, lowBetter) => (v === null ? '' : lowBetter ? (v <= good ? 'good' : v <= ok ? 'ok' : 'bad') : v >= good ? 'good' : v >= ok ? 'ok' : 'bad');
      const div = (a, b) => (b > 0 ? a / b : null), add = (group, l, v, f, status, bench, how, was) => { if (v !== null && Number.isFinite(v)) ratios.push({ group, l, v, f, status, bench, how, prev: was !== null && was !== undefined && Number.isFinite(was) ? was : undefined }); };
      const gmB = F.I > 0 ? pct(F.gross, F.I) : null, gmP = F.pI > 0 ? pct(F.pGross, F.pI) : null, nm_ = F.I > 0 ? pct(F.net, F.I) : null, nmP = F.pI > 0 ? pct(F.pNet, F.pI) : null, xr = F.I > 0 ? pct(F.X, F.I) : null, xrP = F.pI > 0 ? pct(F.pX, F.pI) : null;
      add('Profitability', 'Gross margin', gmB, 'pct', st(gmB, 40, 25), 'healthy above 40%', 'gross profit ÷ revenue', gmP);
      add('Profitability', 'Expense ratio', xr, 'pct', st(xr, 25, 35, true), 'keep under 25% of revenue', 'operating expenses ÷ revenue', xrP);
      add('Profitability', 'Net margin', nm_, 'pct', st(nm_, 12, 4), 'healthy above 12%', 'net profit ÷ revenue', nmP);
      const be = gmB > 0 ? F.X / (gmB / 100) : null;
      add('Profitability', 'Break-even revenue', be, 'money', be === null ? '' : F.I >= be * 1.2 ? 'good' : F.I >= be ? 'ok' : 'bad', F.I && be ? `revenue is ${r1(pct(F.I - be, F.I))}% ${F.I >= be ? 'above' : 'below'} it` : '', 'expenses ÷ gross margin: the sales needed to cover costs in this period');
      add('Returns', 'Return on equity', F.eq > 0 ? pct(F.net * yr, F.eq) : null, 'pct', st(F.eq > 0 ? pct(F.net * yr, F.eq) : null, 20, 8), 'good above 20% a year', 'net profit at a yearly rate ÷ equity');
      add('Returns', 'Return on assets', F.A > 0 ? pct(F.net * yr, F.A) : null, 'pct', st(F.A > 0 ? pct(F.net * yr, F.A) : null, 10, 4), 'good above 10% a year', 'net profit at a yearly rate ÷ total assets');
      const curAll = F.cash + F.recvB + F.curA, curDebt = F.payB + F.curL, wAll = W.cash + W.recvB + W.curA, wDebt = W.payB + W.curL;
      add('Liquidity', 'Current ratio', div(curAll, curDebt), 'x', st(div(curAll, curDebt), 1.5, 1), 'comfortable above 1.5×', 'short-term assets ÷ short-term debts', div(wAll, wDebt));
      add('Liquidity', 'Quick ratio', div(F.cash + F.recvB, curDebt), 'x', st(div(F.cash + F.recvB, curDebt), 1, 0.7), 'comfortable above 1×', 'cash and receivables ÷ short-term debts (stock left out)', div(W.cash + W.recvB, wDebt));
      add('Liquidity', 'Working capital', curAll - curDebt, 'money', curAll - curDebt > 0 ? 'good' : 'bad', 'should stay positive', 'short-term assets less short-term debts', wAll - wDebt);
      add('Leverage', 'Debt to equity', F.eq > 0 ? F.L / F.eq : null, 'x', st(F.eq > 0 ? F.L / F.eq : null, 1, 2, true), 'safer under 1×', 'total liabilities ÷ equity', W.eq > 0 ? W.L / W.eq : null);
      const dsoB = F.I > 0 ? F.recvB / (F.I / days) : null, dpo = F.C > 0 ? F.payB / (F.C / days) : null, dio = F.C > 0 && F.inv > 0 ? F.inv / (F.C / days) : null;
      add('Cash cycle', 'Days to collect (DSO)', dsoB, 'days', st(dsoB, 30, 60, true), 'under 30 days is tight credit control', 'receivables ÷ revenue per day');
      add('Cash cycle', 'Days of stock (DIO)', dio, 'days', st(dio, 45, 90, true), 'under 45 days keeps cash free', 'stock ÷ cost of goods sold per day');
      add('Cash cycle', 'Days to pay suppliers (DPO)', dpo, 'days', '', 'longer is cheaper funding, within agreed terms', 'payables ÷ cost of goods sold per day');
      if (dsoB !== null && dpo !== null) add('Cash cycle', 'Cash conversion cycle', dsoB + (dio || 0) - dpo, 'days', st(dsoB + (dio || 0) - dpo, 30, 75, true), 'the shorter, the less cash the business ties up', 'days to collect + days of stock − days to pay');
    }

    return { O, L, R, P, PO, F, cur, prev, sales, salesPrev, salesGross, growth, custs, active, prevSet, fresh, quiet, byCur, topShare, top3Share, retention, retained, B, pv, monthly, fc, segs, abcRows, owedTotal, overdueList, overdueTotal, debtors, dso, aging, stale, reps, falling, unassigned,
      payTotal, payLate, paySoon, suppliers, bought, BP, dearer, dearerCost, known, gm, knownRev, knownCost, unknown, unknownRev, leaks, cover, outs, thin, allRev, ratios };
  });

  const names = (list, f, n = 3) => list.slice(0, n).map(f).join(', ') + (list.length > n ? ` and ${list.length - n} more` : '');
  const briefText = (goal, steps, back) => `Goal: ${goal}\n\nWhat to do:\n${steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nSend back: ${back}`;
  const cmp = ctx.compareText || 'the period before', signed = (v) => (v >= 0 ? '+' : '-') + M(Math.abs(v));

  const actions = async () => {
    const m = await model(), out = [];
    const add = (a) => out.push(a);
    const debtCols = [COL.name('Customer'), COL.money('overdue', 'Overdue'), COL.int('oldest', 'Oldest, days late'), COL.int('invoices', 'Open invoices'), COL.str('rep', 'Salesperson')];

    if (m.overdueTotal > 0.5) {
      const share = pct(m.overdueTotal, m.owedTotal), worst = m.debtors[0];
      add({ tone: share >= 25 ? 'bad' : 'warn', area: 'Collections', tab: 'in', impact: m.overdueTotal, unit: 'cash to collect now',
        title: `Collect ${M(m.overdueTotal)} that is already overdue`,
        detail: `${m.debtors.length} customer${m.debtors.length === 1 ? ' is' : 's are'} past the due date, ${r1(share)}% of everything owed to you${m.stale > 0.5 ? `; ${M(m.stale)} is more than 60 days late and at real risk of never being paid` : ''}. Start with ${names(m.debtors, (d) => `${d.name} (${M(d.overdue)}, ${d.oldest} days late)`, 2)}.`,
        owner: worst && worst.rep !== '–' ? worst.rep : '',
        breakdown: bd([{ l: 'Overdue', v: m.overdueTotal, f: 'money' }, { l: 'Customers late', v: m.debtors.length, f: 'int' }, { l: 'Share of what is owed', v: share, f: 'pct' }], debtCols, m.debtors),
        brief: { title: 'Collect overdue invoices this week', body: briefText(`bring in ${M(m.overdueTotal)} of overdue customer invoices.`, [`Call these customers first: ${names(m.debtors, (d) => `${d.name} (${M(d.overdue)}, ${d.oldest} days late)`, 5)}.`, 'Agree a payment date with each one and write it down.', 'Hold new deliveries for anyone more than 60 days late until they pay or commit.'], 'a list with each customer, the amount, the promised payment date and anything blocking payment.') } });
    }
    if (m.fc && m.fc.last > 0 && m.fc.mid < m.fc.last * 0.97) {
      const gap = m.fc.last - m.fc.mid;
      add({ tone: 'warn', area: 'Forecast', tab: 'sales', impact: gap, unit: `below ${m.fc.lastLabel} at this pace`,
        title: `The month is heading for ${M(m.fc.mid)}, short of ${m.fc.lastLabel}`,
        detail: `Sales run at ${M(m.fc.perDay)} a day; the likely range is ${M(m.fc.low)} to ${M(m.fc.high)}. Matching ${m.fc.lastLabel} (${M(m.fc.last)}) needs ${M(m.fc.need)} a day for the ${m.fc.left} days left, ${r1(pct(m.fc.need - m.fc.perDay, m.fc.perDay))}% more than now.`,
        brief: { title: 'Close the gap to last month', body: briefText(`lift daily sales from ${M(m.fc.perDay)} to ${M(m.fc.need)} for the rest of the month.`, ['List every open quotation and expected order, with value and date.', 'Call the customers who usually order by now and have not.', 'Propose one offer that can be live within two days.'], 'the list of expected orders and the total you commit to by month end.') } });
    }
    if (m.quiet.length) {
      const at = sum(m.quiet, 'monthly');
      add({ tone: 'warn', area: 'Distributors', tab: 'distributors', impact: at, unit: 'sales per month at stake',
        title: `Win back ${m.quiet.length} distributor${m.quiet.length === 1 ? '' : 's'} who stopped ordering`,
        detail: `They ordered at least twice in the last year but nothing for ${QUIET_DAYS}+ days. Biggest: ${names(m.quiet, (q) => `${q.name} (${q.silent} days silent)`, 3)}.`,
        owner: m.quiet[0].rep !== 'No salesperson' ? m.quiet[0].rep : '',
        breakdown: bd([{ l: 'Distributors', v: m.quiet.length, f: 'int' }, { l: 'Usual sales per month', v: at, f: 'money' }], [COL.name('Distributor'), COL.money('monthly', 'Usual month'), COL.int('silent', 'Days silent'), COL.str('last', 'Last order'), COL.str('rep', 'Salesperson')], m.quiet),
        brief: { title: 'Call the distributors who stopped ordering', body: briefText(`get a new order from distributors who have gone quiet (worth about ${M(at)} a month).`, [`Contact: ${names(m.quiet, (q) => `${q.name} (last order ${q.last})`, 6)}.`, 'Ask why they stopped: stock left, price, a competitor, delivery or payment problems.', 'Offer the current promotion and take the order on the call if you can.'], 'for each distributor: the reason they stopped and the next order date or value.') } });
    }
    if (m.leaks.length) {
      const gain = sum(m.leaks, 'gain');
      add({ tone: m.leaks.some((l) => l.margin < 0) ? 'bad' : 'warn', area: 'Margin', tab: 'profit', impact: gain, unit: 'more profit this period at your average margin',
        title: `Fix the margin on ${m.leaks.length} product${m.leaks.length === 1 ? '' : 's'}`,
        detail: `Your average gross margin is ${r1(m.gm)}%. These sell well but earn much less: ${names(m.leaks, (l) => `${bare(l.name)} (${r1(l.margin)}%)`, 3)}. Raise the price, trim the offer or cut the cost.`,
        breakdown: bd([{ l: 'Average margin', v: m.gm, f: 'pct' }, { l: 'Profit left on the table', v: gain, f: 'money' }], [COL.name('Product'), COL.money('gain', 'Profit left'), COL.pct('margin', 'Margin'), COL.money('rev', 'Sales'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }], m.leaks),
        brief: { title: 'Review prices on our lowest-margin products', body: briefText(`lift the margin on products earning well below our ${r1(m.gm)}% average.`, [`Review: ${names(m.leaks, (l) => `${l.name} (${r1(l.margin)}% margin)`, 6)}.`, 'For each one propose a new price, a smaller discount or a cheaper pack, with the expected margin.', 'Check the cost in Odoo is right before changing a price.'], 'a table with product, current price, proposed price and new margin.') } });
    }
    if (m.pv.price < 0 && m.pv.prev > 0 && -m.pv.price >= m.pv.prev * 0.01) add({ tone: 'warn', area: 'Pricing', tab: 'sales', impact: -m.pv.price, unit: `given away in lower prices against ${cmp}`,
      title: 'Average selling prices slipped', detail: `The same products sold for less per unit than in ${cmp}: discounts and offers cost ${M(-m.pv.price)} of revenue, while volume ${m.pv.volume >= 0 ? 'added' : 'removed'} ${M(Math.abs(m.pv.volume))}. Biggest price drops: ${names(m.pv.rows.filter((r) => r.priceFx < 0).sort((a, b) => a.priceFx - b.priceFx), (r) => `${bare(r.name)} (${r.priceChg}%)`, 3)}.` });
    if (m.outs.length || m.thin.length) {
      const list = [...m.outs, ...m.thin], wk = sum(list, 'week');
      add({ tone: m.outs.length ? 'bad' : 'warn', area: 'Stock', tab: 'finished', impact: wk, unit: 'sales at risk every week',
        title: m.outs.length ? `Restock ${m.outs.length} selling product${m.outs.length === 1 ? '' : 's'} now at zero${m.thin.length ? `, ${m.thin.length} more within two weeks` : ''}` : `${m.thin.length} best seller${m.thin.length === 1 ? '' : 's'} will run out within two weeks`,
        detail: `At the current rate of sale: ${names(list, (o) => `${bare(o.name)} (${o.qty <= 0 ? 'none left' : Math.round(o.cover) + ' days left'})`, 4)}.`,
        breakdown: bd([{ l: 'Products', v: list.length, f: 'int' }], [COL.name('Product'), COL.int('qty', 'On hand'), { key: 'cover', label: 'Days of cover', fmt: 'num1' }, COL.int('unitsWeek', 'Units sold per week'), COL.money('week', 'Sales per week')], list),
        brief: { title: 'Restock best sellers before they run out', body: briefText('keep our selling products in stock.', [`Out or nearly out: ${names(list, (o) => `${o.name} (${o.qty <= 0 ? 'zero' : Math.round(o.cover) + ' days left'})`, 8)}.`, 'Confirm the real count in the warehouse against Odoo.', 'Give the date each one will be available again and what is needed to make it happen.'], 'product, real quantity, date back in stock.') } });
    }
    if (m.falling.length) {
      const gap = sum(m.falling, 'gap');
      add({ tone: 'warn', area: 'Salespeople', tab: 'people', impact: gap, unit: `less than ${cmp}`,
        title: m.falling.length === 1 ? `${m.falling[0].name} is selling ${Math.abs(m.falling[0].growth)}% less` : `${m.falling.length} salespeople are selling less than before`,
        detail: `${names(m.falling, (r) => `${r.name} ${r.growth}% (${M(r.sales)} against ${M(r.prev)}, ${r.lost} customer${r.lost === 1 ? '' : 's'} did not reorder)`, 3)}.`,
        owner: m.falling[0].name,
        breakdown: bd([{ l: 'Sales gap', v: gap, f: 'money' }], [COL.name('Salesperson'), COL.money('sales', 'This period'), COL.money('prev', 'Before'), { key: 'growth', label: 'Change', fmt: 'growth' }, COL.int('lost', 'Customers not reordering')], m.falling),
        brief: { title: 'Sales recovery plan', body: briefText(`recover ${M(gap)} of sales lost against ${cmp}.`, ['List the customers who bought before and have not ordered in this period.', 'Call each one this week and record the outcome.', 'Name the three biggest deals you can close before the end of the month.'], 'the customer list with call results and expected order values.') } });
    }
    if (m.dearerCost > 0.5) add({ tone: 'warn', area: 'Suppliers', tab: 'suppliers', impact: m.dearerCost, unit: 'extra cost in the last 90 days',
      title: `Suppliers raised prices on ${m.dearer.length} item${m.dearer.length === 1 ? '' : 's'}`, detail: `Compared with the 90 days before: ${names(m.dearer, (r) => `${bare(r.name)} +${r.chg}% from ${r.sup}`, 3)}. Renegotiate, find a second source, or pass it on in your prices before it eats the margin.`,
      breakdown: bd([{ l: 'Extra cost', v: m.dearerCost, f: 'money' }], [COL.name('Item'), COL.str('sup', 'Supplier'), { key: 'was', label: 'Price before', fmt: 'money2' }, { key: 'now', label: 'Price now', fmt: 'money2' }, { key: 'chg', label: 'Change', fmt: 'growth' }, COL.money('extra', 'Extra cost')], m.dearer),
      brief: { title: 'Challenge supplier price increases', body: briefText(`win back part of ${M(m.dearerCost)} of supplier price increases.`, [`Items: ${names(m.dearer, (r) => `${r.name} (${r.sup}, +${r.chg}%)`, 6)}.`, 'Ask each supplier to justify the increase and offer a volume or payment-term deal.', 'Get one competing quote for the three biggest items.'], 'old price, new price, negotiated price and the saving for each item.') } });
    if (m.F) {
      const F = m.F, ratio = F.I > 0 ? F.X / F.I : null, pRatio = F.pI > 0 ? F.pX / F.pI : null;
      if (F.net < 0) add({ tone: 'bad', area: 'Profit & loss', tab: 'pnl', impact: -F.net, unit: 'net loss this period', title: `The books show a loss of ${M(-F.net)}`, detail: `Revenue ${M(F.I)}, cost of revenue ${M(F.C)}, expenses ${M(F.X)}. Biggest expenses: ${names(F.expRows, (r) => `${r.name} (${M(r.now)})`, 3) || 'none posted'}.` });
      if (ratio !== null && pRatio !== null && F.X > F.pX && ratio > pRatio + 0.01) {
        const excess = F.X - pRatio * F.I, movers = F.expRows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff);
        add({ tone: 'warn', area: 'Profit & loss', tab: 'pnl', impact: excess, unit: 'spent above your earlier expense ratio',
          title: 'Expenses grew faster than sales',
          detail: `Expenses are ${r1(ratio * 100)}% of revenue, up from ${r1(pRatio * 100)}%. Biggest increases: ${names(movers, (r) => `${r.name} (+${M(r.diff)})`, 3)}.`,
          breakdown: bd([{ l: 'Expenses', v: F.X, f: 'money' }, { l: 'Before', v: F.pX, f: 'money' }], [COL.str('code', 'Code'), COL.str('name', 'Account'), COL.money('now', 'This period'), COL.money('prev', 'Before'), COL.money('diff', 'Increase')], movers) });
      }
      const due = m.paySoon + m.payLate;
      if (due > F.cash && due > 0.5) add({ tone: 'bad', area: 'Cash', tab: 'out', impact: due - F.cash, unit: 'short for bills due within 7 days', title: 'Bills due this week are more than the cash on hand', detail: `${M(due)} of supplier bills are overdue or due within 7 days; cash and bank hold ${M(F.cash)}. Collect faster or agree later dates with suppliers.` });
    }
    if (m.topShare >= 30 && m.byCur.length > 1) add({ tone: 'info', area: 'Distributors', tab: 'distributors', impact: null, title: `${m.byCur[0].name} is ${r1(m.topShare)}% of your sales`, detail: `Your top three customers are ${r1(m.top3Share)}% of sales. One lost account would hurt: grow the next five so no single customer is above a quarter.` });
    if (m.suppliers.length > 1 && m.suppliers[0].share >= 40) add({ tone: 'info', area: 'Suppliers', tab: 'suppliers', impact: null, title: `${m.suppliers[0].name} supplies ${r1(m.suppliers[0].share)}% of what you buy`, detail: `That is ${M(m.suppliers[0].amount)} in 6 months. Get a second quote for their main items: it protects supply and gives you room to negotiate.`,
      brief: { title: 'Get a second supplier quote', body: briefText(`reduce our dependence on ${m.suppliers[0].name} and check we pay a fair price.`, ['List the five items we buy most from this supplier, with quantity and current price.', 'Get written quotes for the same items from two other suppliers.', 'Compare price, payment terms and delivery time.'], 'a comparison table and your recommendation.') } });
    if (m.unknown.length) add({ tone: 'info', area: 'Margin', tab: 'profit', impact: null, title: `Set a cost on ${m.unknown.length} product${m.unknown.length === 1 ? '' : 's'} in Odoo`, detail: `${M(m.unknownRev)} of sales (${r1(pct(m.unknownRev, m.allRev))}%) has no cost, so its profit is invisible here: ${names(m.unknown, (l) => bare(l.name), 3)}.` });
    if (m.unassigned && m.unassigned.share >= 10) add({ tone: 'info', area: 'Salespeople', tab: 'people', impact: null, title: `${r1(m.unassigned.share)}% of sales has no salesperson on the order`, detail: `${M(m.unassigned.sales)} across ${m.unassigned.orders} order${m.unassigned.orders === 1 ? '' : 's'} cannot be credited to anyone. Make the Salesperson field required on sales orders in Odoo.` });
    if (m.fresh.length) add({ tone: 'good', area: 'Distributors', tab: 'distributors', impact: sum(m.fresh, 'cur'), unit: 'from first-time customers', title: `${m.fresh.length} new customer${m.fresh.length === 1 ? '' : 's'} ordered`, detail: `No order from them in the year before: ${names(m.fresh.slice().sort((a, b) => b.cur - a.cur), (c) => `${c.name} (${M(c.cur)})`, 3)}. Follow up early so they reorder.` });
    const star = m.reps.filter((r) => r.name !== 'No salesperson' && r.growth !== null && r.growth >= 15 && r.share >= 5).sort((a, b) => (b.sales - b.prev) - (a.sales - a.prev))[0];
    if (star) add({ tone: 'good', area: 'Salespeople', tab: 'people', impact: star.sales - star.prev, unit: `more than ${cmp}`, title: `${star.name} is up ${star.growth}%`, detail: `${M(star.sales)} from ${star.orders} order${star.orders === 1 ? '' : 's'} and ${star.customers} customer${star.customers === 1 ? '' : 's'}. Find out what they are doing and share it with the team.` });
    if (m.fc && m.fc.last > 0 && m.fc.mid >= m.fc.last * 1.03) add({ tone: 'good', area: 'Forecast', tab: 'sales', impact: m.fc.mid - m.fc.last, unit: `above ${m.fc.lastLabel} at this pace`, title: `The month is on course for ${M(m.fc.mid)}`, detail: `Likely range ${M(m.fc.low)} to ${M(m.fc.high)}, against ${M(m.fc.last)} in ${m.fc.lastLabel}. Make sure stock and delivery can keep up.` });

    const rank = (a) => (a.tone === 'good' ? 2 : a.impact === null ? 1 : 0);
    out.sort((a, b) => rank(a) - rank(b) || (b.impact || 0) - (a.impact || 0));

    const parts = [];
    if (m.growth !== null) parts.push({ l: 'Sales growth', v: clamp((m.growth + 20) / 40), t: `${m.growth >= 0 ? '+' : ''}${m.growth}% against ${cmp}` });
    if (m.gm !== null) parts.push({ l: 'Gross margin', v: clamp(m.gm / 45), t: `${r1(m.gm)}% on products with a cost` });
    if (m.owedTotal > 0) parts.push({ l: 'Collections', v: clamp(1 - m.overdueTotal / m.owedTotal), t: `${r1(pct(m.overdueTotal, m.owedTotal))}% of what customers owe is overdue` });
    if (m.F && m.F.payB + m.F.curL > 0) { const cr = (m.F.cash + m.F.recvB + m.F.curA) / (m.F.payB + m.F.curL); parts.push({ l: 'Liquidity', v: clamp((cr - 0.5) / 1.5), t: `current ratio ${cr.toFixed(2)}×` }); }
    if (m.sales > 0 && m.byCur.length) parts.push({ l: 'Customer spread', v: clamp(1 - (m.topShare - 10) / 40), t: `biggest customer is ${r1(m.topShare)}% of sales` });
    if (m.retention !== null && m.prevSet.size >= 3) parts.push({ l: 'Customer retention', v: clamp(m.retention / 80), t: `${r1(m.retention)}% of customers from ${cmp} ordered again` });
    const score = parts.length ? Math.round((parts.reduce((a, p) => a + p.v, 0) / parts.length) * 100) : null;

    // the written summary, as an analyst would open the report
    const memo = [], Bs = (k) => sum(m.B[k], 'value');
    memo.push(`Net sales were ${M(m.sales)}${m.growth !== null ? `, ${m.growth >= 0 ? 'up' : 'down'} ${Math.abs(m.growth)}% on ${cmp}` : ''}, from ${m.cur.length} orders by ${m.active.length} customers (average order ${M(m.cur.length ? m.sales / m.cur.length : 0)}).`);
    if (m.salesPrev > 0) memo.push(`The change of ${signed(m.sales - m.salesPrev)} breaks down as: new and returning customers ${signed(Bs('fresh') + Bs('back'))}, customers who bought more ${signed(Bs('up'))}, customers who bought less ${signed(Bs('down'))}, and customers who did not order ${signed(Bs('gone'))}.${m.pv.prev > 0 ? ` On the products sold in both periods, price moved revenue by ${signed(m.pv.price)} and volume by ${signed(m.pv.volume)}.` : ''}`);
    if (m.gm !== null || m.F) memo.push(`${m.gm !== null ? `Gross margin on products with a cost is ${r1(m.gm)}%. ` : ''}${m.F ? `The books show ${m.F.net >= 0 ? 'a net profit' : 'a net loss'} of ${M(Math.abs(m.F.net))}${m.F.I > 0 ? ` (${r1(pct(m.F.net, m.F.I))}% of revenue)` : ''}, with expenses at ${m.F.I > 0 ? r1(pct(m.F.X, m.F.I)) + '% of revenue' : M(m.F.X)}.` : ''}`);
    memo.push(`Customers owe ${M(m.owedTotal)}, of which ${M(m.overdueTotal)} (${r1(pct(m.overdueTotal, m.owedTotal))}%) is overdue${m.dso !== null ? `; that is ${Math.round(m.dso)} days of sales waiting to be collected` : ''}. You owe suppliers ${M(m.payTotal)}${m.F ? ` and hold ${M(m.F.cash)} in cash and bank` : ''}.`);
    if (m.fc) memo.push(`At the current pace the month closes between ${M(m.fc.low)} and ${M(m.fc.high)}${m.fc.last > 0 ? `, against ${M(m.fc.last)} in ${m.fc.lastLabel}` : ''}.`);
    const first = out.find((a) => a.tone !== 'good'); if (first) memo.push(`First priority: ${first.title.charAt(0).toLowerCase() + first.title.slice(1)}.`);
    return { items: out, score, parts, memo, gaps: [...new Set(gaps)] };
  };

  const tiles = async () => {
    const m = await model(), F = m.F, T = [];
    T.push(tile('Net sales', m.sales, 'money', { prev: m.salesPrev, sub: `${m.cur.length} orders · ${m.active.length} customers`, daily: daily(ctx, m.cur, m.prev, (o) => o.d, (o) => o.net),
      breakdown: bd([{ l: 'Orders', v: m.cur.length, f: 'int' }, { l: 'Customers', v: m.active.length, f: 'int' }, { l: 'Average order', v: m.cur.length ? m.sales / m.cur.length : 0, f: 'money' }], [COL.name('Customer'), COL.money('cur', 'Sales'), COL.money('prev', 'Before'), COL.str('rep', 'Salesperson')], m.byCur) }));
    if (m.fc) T.push(tile('Month-end forecast', m.fc.mid, 'money', { prev: m.fc.last || undefined, sub: `range ${M(m.fc.low)} to ${M(m.fc.high)} · ${m.fc.left} days left` }));
    if (m.gm !== null) T.push(tile('Gross margin', m.gm, 'pct', { sub: `${M(m.knownRev - m.knownCost)} gross profit` + (m.unknown.length ? ` · ${m.unknown.length} products without a cost` : '') }));
    if (F) T.push(tile('Net profit', F.net, 'money', { prev: F.pNet, sub: F.I ? `${r1(pct(F.net, F.I))}% of revenue in the books` : 'from the posted journals',
      breakdown: { summary: [{ l: 'Revenue', v: F.I, f: 'money' }, { l: 'Cost of revenue', v: F.C, f: 'money' }, { l: 'Expenses', v: F.X, f: 'money' }], columns: [{ key: 'step', label: 'Step', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }], rows: [{ step: 'Revenue', amount: F.I }, { step: 'Cost of revenue', amount: -F.C }, { step: 'Expenses', amount: -F.X }, { step: 'Net profit', amount: F.net }], more: 0, plain: true } }));
    if (F) { const burn = (F.C + F.X) / days; T.push(tile('Cash and bank', F.cash, 'money', { prev: F.was.cash, sub: burn > 0 ? `covers ${Math.max(0, Math.round(F.cash / burn))} days of costs` : `on ${e}` })); }
    T.push(tile('Customers owe you', m.owedTotal, 'money', { goodDown: true, sub: `${M(m.overdueTotal)} overdue` + (m.dso !== null ? ` · ${Math.round(m.dso)} days of sales` : ''),
      breakdown: bd([{ l: 'Open invoices', v: m.R.length, f: 'int' }, { l: 'Overdue', v: m.overdueTotal, f: 'money' }], [COL.name('Invoice'), COL.str('cust', 'Customer'), COL.str('due', 'Due'), COL.money('owed', 'Still owed'), COL.int('late', 'Days late')], m.R.slice().sort((a, b) => b.owed - a.owed)) }));
    T.push(tile('You owe suppliers', m.payTotal, 'money', { goodDown: true, sub: `${M(m.payLate)} overdue · ${M(m.paySoon)} due in 7 days`,
      breakdown: bd([{ l: 'Open bills', v: m.P.length, f: 'int' }], [COL.name('Bill'), COL.str('sup', 'Supplier'), COL.str('due', 'Due'), COL.money('owed', 'Still to pay'), COL.int('late', 'Days late')], m.P.slice().sort((a, b) => b.owed - a.owed)) }));
    T.push(tile('Active customers', m.active.length, 'int', { prev: m.prevSet.size, sub: `${m.fresh.length} new · ${m.quiet.length} gone quiet` + (m.retention !== null ? ` · ${r1(m.retention)}% came back` : '') }));
    return { tiles: T };
  };

  const stmt = (style, code, name, now, prev, I, pI) => ({ style, code, name, now, ofRev: I ? pct(now, I) : null, prev, ofRevP: pI ? pct(prev, pI) : null, diff: now - prev, chg: prev ? r1(((now - prev) / Math.abs(prev)) * 100) : null });
  const sec = (chapter, ...a) => { const run = section(...a); const f = async () => ({ ...(await run()), chapter }); f.sid = a[0]; return f; };
  const top3 = (list) => names(list, (r) => `${r.name} (${signed(r.value)})`, 3);
  return [
    sec('Summary', 'actions', `Management summary and priorities (${ctx.monthLabel})`, 'actions', actions),
    sec('Summary', 'kpi', 'Headline numbers', 'kpi', tiles, 'Click a card to see what is behind it. Sales are confirmed orders before tax; net profit and cash come from the posted journals.'),

    sec('Growth', 'trend', 'Sales over 12 months', 'trend', async () => {
      const m = await model();
      return { rows: m.monthly, selectable: true, metrics: [{ key: 'sales', label: 'Net sales', fmt: 'money' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'customers', label: 'Active customers', fmt: 'int' }, { key: 'fresh', label: 'New customers', fmt: 'int' }, { key: 'avg', label: 'Average order', fmt: 'money' }, { key: 'repeat', label: 'Customers who ordered again next month', fmt: 'pct' }] };
    }, 'Pick a measure on the right. Click a month to open the whole report for that month.'),
    sec('Growth', 'bridge', `Why sales changed: customer by customer`, 'bridge', async () => {
      const m = await model(), v = (k) => sum(m.B[k], 'value'), row = (step, k) => ({ step, amount: v(k), n: m.B[k].length, who: top3(m.B[k]) });
      return { unit: 'customers', steps: [{ step: 'Compared period', amount: m.salesPrev, total: true }, row('New customers', 'fresh'), row('Came back', 'back'), row('Bought more', 'up'), row('Bought less', 'down'), row('Did not order', 'gone'), { step: 'This period', amount: m.sales, total: true }] };
    }, `From ${cmp} to this period. "New" is a first order in 13 months; "came back" ordered before but not in the compared period.`),
    sec('Growth', 'pvm', 'Why sales changed: price against volume', 'bridge', async () => {
      const m = await model(), p = m.pv, cnt = (k) => p.rows.filter((r) => r.kind === k).length;
      const both = p.rows.filter((r) => r.kind === 'Both periods');
      return { unit: 'products', steps: [{ step: 'Compared period', amount: p.prev, total: true }, { step: 'Price', amount: p.price, n: both.length, who: names(both.filter((r) => Math.abs(r.priceFx) > 0.5).sort((a, b) => Math.abs(b.priceFx) - Math.abs(a.priceFx)), (r) => `${bare(r.name)} (${signed(r.priceFx)})`, 3) }, { step: 'Volume', amount: p.volume, n: both.length, who: names(both.slice().sort((a, b) => Math.abs(b.volFx) - Math.abs(a.volFx)), (r) => `${bare(r.name)} (${signed(r.volFx)})`, 3) },
        { step: 'New products', amount: p.added, n: cnt('New'), who: names(p.rows.filter((r) => r.kind === 'New'), (r) => bare(r.name), 3) }, { step: 'Products not sold', amount: p.dropped, n: cnt('Not sold now'), who: names(p.rows.filter((r) => r.kind === 'Not sold now'), (r) => bare(r.name), 3) }, { step: 'This period', amount: p.cur, total: true }] };
    }, 'Price: the same products sold at a higher or lower price per unit (discounts and offers show here). Volume: more or fewer units at the old price.'),
    sec('Growth', 'movers', 'Products that moved sales the most', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Product'), COL.money('total', 'Effect on sales'), COL.money('priceFx', 'From price'), COL.money('volFx', 'From volume'), { key: 'priceChg', label: 'Price per unit', fmt: 'growth' }, { key: 'volChg', label: 'Units', fmt: 'growth' }, COL.str('kind', 'Sold in')], rows: m.pv.rows.slice(0, 60), empty: 'No product lines to compare.' };
    }),

    sec('Customers', 'segments', 'Customer segments (last 12 months)', 'table', async () => {
      const m = await model();
      return { columns: [COL.name('Segment'), { key: 'value', label: 'Sales in 12 months', fmt: 'money', bar: true }, COL.int('customers', 'Customers'), COL.pct('share', 'Share of sales'), COL.int('orders', 'Orders'), COL.str('todo', 'What to do')],
        rows: m.segs.filter((g) => g.customers).map((g) => ({ name: g.name, value: g.value, customers: g.customers, share: g.share, orders: g.orders, todo: g.todo,
          breakdown: bd([{ l: 'Customers', v: g.customers, f: 'int' }, { l: 'Sales in 12 months', v: g.value, f: 'money' }], [COL.name('Customer'), COL.money('total', 'Sales in 12 months'), COL.int('n', 'Orders'), COL.str('last', 'Last order'), COL.str('rep', 'Salesperson')], g.list) })), empty: 'No customers in the last 12 months.' };
    }, 'Each customer is placed by how recently, how often and how much they order. Click a segment for the names.'),
    sec('Customers', 'abc', `Concentration: who makes the sales (${ctx.monthLabel})`, 'table', async () => {
      const m = await model();
      return { columns: [COL.name('Group'), COL.str('what', 'Covers'), COL.int('count', 'How many'), COL.pct('ofAll', 'Of all'), COL.money('sales', 'Sales'), COL.pct('share', 'Of sales')], rows: m.abcRows.filter((r) => r.count), empty: 'No sales in this period.' };
    }, 'Class A is the small group that brings the first 80% of sales: protect it. Class C is the long tail: serve it cheaply.'),
    sec('Customers', 'quiet', 'Distributors who stopped ordering', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Distributor'), { key: 'monthly', label: 'Usual month', fmt: 'money', bar: true }, COL.int('silent', 'Days silent'), COL.str('last', 'Last order'), COL.int('orders', 'Orders before'), COL.str('rep', 'Salesperson')], rows: m.quiet.slice(0, 200), empty: `Every regular distributor ordered in the last ${QUIET_DAYS} days.` };
    }, `Ordered at least twice in the last year, then nothing for ${QUIET_DAYS} days or more. "Usual month" is their average since their first order.`),

    sec('Sales team', 'reps', `Salespeople scoreboard (${ctx.monthLabel})`, 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Salesperson'), { key: 'sales', label: 'Sales', fmt: 'money', bar: true }, { key: 'growth', label: 'Change', fmt: 'growth' }, COL.pct('share', 'Share'), COL.int('orders', 'Orders'), COL.int('customers', 'Customers'), COL.money('avg', 'Average order'), COL.int('won', 'New customers'), COL.int('lost', 'Did not reorder'), COL.pct('keep', 'Kept'), COL.pct('lean', 'From biggest customer'), COL.money('overdue', 'Overdue from their customers')],
        rows: m.reps.filter((r) => r.sales || r.prev).map((r) => ({ name: r.name, sales: r.sales, growth: r.growth, share: r.share, orders: r.orders, customers: r.customers, avg: r.avg, won: r.won, lost: r.lost, keep: r.keep, lean: r.lean, overdue: r.overdue,
          breakdown: bd([{ l: 'Customers', v: r.customers, f: 'int' }, { l: 'Before', v: r.prev, f: 'money' }], [COL.name('Customer'), COL.money('value', 'Sales')], r.top) })), empty: 'No confirmed orders in this period.' };
    }, '"Kept" is the share of their customers from the compared period who ordered again. "From biggest customer" shows how much one account carries them. Overdue is unpaid money from their customers.'),

    sec('Products and margin', 'leaks', `Products earning less than they should (${ctx.monthLabel})`, 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Product'), { key: 'gain', label: 'Profit left on the table', fmt: 'money', bar: true }, COL.pct('margin', 'Margin'), COL.money('rev', 'Sales'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.int('units', 'Units')], rows: m.leaks.slice(0, 100), empty: m.gm === null ? 'No product has a cost set in Odoo, so margins cannot be worked out.' : 'No selling product is far below your average margin.' };
    }, 'Products at least 8 points under your average gross margin, or sold at a loss. "Profit left" is what they would add at the average margin.'),
    sec('Products and margin', 'cover', 'Stock cover on your best sellers', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Product'), { key: 'cover', label: 'Days of cover', fmt: 'num1', bar: true, barReverse: true }, COL.int('qty', 'On hand'), { key: 'perDay', label: 'Units sold per day', fmt: 'num1' }, COL.int('unitsWeek', 'Units sold per week'), COL.money('week', 'Sales per week')], rows: m.cover.slice().sort((a, b) => a.cover - b.cover).slice(0, 60), empty: 'Stock levels could not be read for the products sold.' };
    }, 'On-hand quantity divided by the rate of sale in this period. Under 14 days needs an order now.'),

    sec('Cash and credit', 'aging', 'What customers owe, by age', 'table', async () => {
      const m = await model();
      return { columns: [COL.name('Age'), { key: 'value', label: 'Amount', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('invoices', 'Invoices'), COL.int('customers', 'Customers')], rows: m.aging, empty: 'No open invoices.' };
    }, 'The older a debt, the less likely it is paid. Anything over 60 days needs a decision: payment plan, stop supply, or write it off.'),
    sec('Cash and credit', 'collect', 'Who to collect from first', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Customer'), { key: 'overdue', label: 'Overdue', fmt: 'money', bar: true }, COL.int('oldest', 'Oldest, days late'), COL.int('invoices', 'Open invoices'), COL.money('owed', 'Total owed'), COL.str('rep', 'Salesperson')],
        rows: m.debtors.slice(0, 200).map((d) => ({ name: d.name, overdue: d.overdue, oldest: d.oldest, invoices: d.invoices, owed: d.owed, rep: d.rep,
          breakdown: bd([{ l: 'Overdue', v: d.overdue, f: 'money' }, { l: 'Total owed', v: d.owed, f: 'money' }], [COL.name('Invoice'), COL.str('date', 'Date'), COL.str('due', 'Due'), COL.money('owed', 'Still owed'), COL.int('late', 'Days late')], d.list.slice().sort((a, b) => b.late - a.late)) })), empty: 'Nothing is overdue.' };
    }, 'Unpaid invoices past their due date, biggest first. The salesperson is the one on the customer\'s latest order.'),
    sec('Cash and credit', 'ratios', `Financial ratios (${ctx.monthLabel})`, 'ratios', async () => {
      const m = await model(); if (!m.F) throw new Error('Accounting could not be read, so the ratios cannot be worked out.');
      return { ratios: m.ratios };
    }, 'Worked out from the posted journals. Benchmarks are general rules for a trading and manufacturing business, not targets set for Bless. Entries posted only at month end (salaries, rent) make a part-month look better than it is.'),

    sec('Supply', 'suppliers', 'Supplier dependence (last 6 months)', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Supplier'), { key: 'amount', label: 'Bought', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('orders', 'Orders'), COL.money('cur', 'This period'), COL.money('owed', 'You owe them')], rows: m.suppliers.slice(0, 100), empty: 'No purchase orders in this time.' };
    }, 'Confirmed purchase orders. A supplier above 40% of your buying is a risk worth a second quote.'),
    sec('Supply', 'prices', 'Purchase prices that moved', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Item'), COL.money('extra', 'Effect on cost'), { key: 'chg', label: 'Change', fmt: 'growth' }, { key: 'was', label: 'Price before', fmt: 'money2' }, { key: 'now', label: 'Price now', fmt: 'money2' }, COL.int('qty', 'Bought (90 days)'), COL.str('sup', 'Supplier')], rows: m.BP.slice(0, 100), empty: 'No item changed price by 3% or more between the last 90 days and the 90 before.' };
    }, 'Average price paid per unit in the last 90 days against the 90 days before, for items bought in both. A negative effect is a saving.'),

    sec('Financial statements', 'pltrend', 'Profit over 12 months', 'trend', async () => {
      const F = (await model()).F; if (!F || !F.monthly) throw new Error('The monthly journals could not be read.');
      return { rows: F.monthly.map((r) => ({ key: r.key, label: r.label, values: { revenue: r.I, gross: r.I - r.C, expenses: r.X, net: r.I - r.C - r.X, margin: r.I ? pct(r.I - r.C - r.X, r.I) : 0 } })), selectable: true,
        metrics: [{ key: 'net', label: 'Net profit', fmt: 'money' }, { key: 'revenue', label: 'Revenue', fmt: 'money' }, { key: 'gross', label: 'Gross profit', fmt: 'money' }, { key: 'expenses', label: 'Expenses', fmt: 'money' }, { key: 'margin', label: 'Net margin', fmt: 'pct' }], monthBars: { keys: ['revenue', 'gross', 'net'], base: 'revenue' } };
    }, 'From the posted journal entries, month by month.'),
    sec('Financial statements', 'pl', `Profit and loss, with each line as a share of revenue (${ctx.monthLabel})`, 'table', async () => {
      const F = (await model()).F; if (!F) throw new Error('Accounting could not be read, so there is no profit and loss here.');
      const top = F.expRows.filter((r) => Math.abs(r.now) >= 0.5 || Math.abs(r.prev) >= 0.5).slice(0, 10), rest = F.X - sum(top, 'now'), restP = F.pX - sum(top, 'prev'), S_ = (st, code, name, a, b) => stmt(st, code, name, a, b, F.I, F.pI);
      return { columns: [COL.str('code', 'Code'), COL.str('name', 'Line'), COL.money('now', 'This period'), COL.pct('ofRev', '% of revenue'), COL.money('prev', 'Compared period'), COL.pct('ofRevP', '% of revenue'), COL.money('diff', 'Variance'), { key: 'chg', label: 'Change', fmt: 'growth' }],
        rows: [S_('total', '', 'Revenue', F.I, F.pI), S_('line', '', 'Cost of revenue', F.C, F.pC), S_('total', '', 'Gross profit', F.gross, F.pGross), S_('head', '', 'Expenses', F.X, F.pX), ...top.map((r) => S_('line', r.code, r.name, r.now, r.prev)), ...(Math.abs(rest) >= 0.5 || Math.abs(restP) >= 0.5 ? [S_('line', '', 'All other expenses', rest, restP)] : []), S_('total', '', 'Net profit', F.net, F.pNet)] };
    }, 'From the posted journal entries. The full statement, account by account, is under Finance, Profit & loss.'),
    sec('Financial statements', 'bs', `Balance sheet (on ${e}, against ${pe})`, 'table', async () => {
      const F = (await model()).F; if (!F) throw new Error('Accounting could not be read, so there is no balance sheet here.');
      const W = F.was, row = (style, name, k, f) => { const a = f ? f(F) : F[k], b = f ? f(W) : W[k]; return { style, code: '', name, amount: a, share: F.A ? pct(a, F.A) : null, was: b, diff: a - b }; };
      return { columns: [COL.str('code', ''), COL.str('name', 'Line'), COL.money('amount', 'Now'), COL.pct('share', 'Of total assets'), COL.money('was', 'At the compared date'), COL.money('diff', 'Movement')],
        rows: [row('head', 'What you own', 'A'), row('line', 'Cash and bank', 'cash'), row('line', 'Customers owe you', 'recvB'), row('line', 'Stock', 'inv'), row('line', 'Other short-term assets', '', (x) => x.curA - x.inv), row('line', 'Equipment and long-term assets', 'fixedA'), row('total', 'Total assets', 'A'),
          row('head', 'What you owe', 'L'), row('line', 'Suppliers', 'payB'), row('line', 'Other short-term debts', 'curL'), row('line', 'Long-term debts', 'longL'), row('total', 'Total liabilities', 'L'),
          row('total', 'Equity (yours), including profit to date', 'eq'), ...(Math.abs(F.other) >= 0.5 ? [row('line', 'Accounts with an unrecognised type', 'other')] : [])] };
    }, 'Every posted entry up to the date shown. "Stock" is the short-term asset accounts named stock or inventory. The full balance sheet is under Finance, Balance sheet.'),
  ];
}
