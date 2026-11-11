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
const QUIET_DAYS = 45, LOOK_DAYS = 180;

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
  const lookStart = [ps, addDays(e, -LOOK_DAYS)].sort()[0], lookDays = between(lookStart, e) + 1;
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
    return list.map((o) => ({ name: o.name, d: day(o.date_order), cust: custOf(o.partner_id), rep: who(o), net: n0(o.amount_untaxed), gross: n0(o.amount_total) }));
  }, []);

  const lines = () => soft('lines', 'Products sold', async () => {
    const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(s)], ['order_id.date_order', '<=', dtEnd(e)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 40000 });
    const m = new Map();
    for (const l of list) { const k = nid(l.product_id); if (!k) continue; const g = m.get(k) || { pid: k, name: nm(l.product_id), rev: 0, units: 0 }; g.rev += n0(l.price_subtotal); g.units += n0(l.product_uom_qty); m.set(k, g); }
    const arr = [...m.values()].sort((a, b) => b.rev - a.rev);
    const costs = await costsOf(cfg, arr.map((g) => g.pid));
    for (const g of arr) { const c = costs.get(g.pid); g.unit = c > 0 ? c : null; g.cost = g.unit !== null ? g.unit * g.units : null; g.profit = g.cost !== null ? g.rev - g.cost : null; g.margin = g.cost !== null && g.rev ? pct(g.rev - g.cost, g.rev) : null; }
    return arr;
  }, []);

  const resid = (m) => Math.abs(n0(m.amount_residual_signed ?? m.amount_residual));
  const openMoves = (type) => sr(cfg, 'account.move', [['move_type', '=', type], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]], ['name', 'partner_id', 'invoice_user_id', 'invoice_date', 'invoice_date_due', 'amount_residual_signed', 'amount_residual'], { app: 'Accounting', limit: 20000 });
  const lateBy = (due) => (due && due < today ? between(due, today) : 0);
  const recv = () => soft('recv', 'Customer invoices', async () => {
    const list = await openMoves('out_invoice');
    await learn(list.map((m) => nid(m.partner_id)));
    return list.map((m) => ({ name: m.name, cust: custOf(m.partner_id), rep: nm(m.invoice_user_id), date: m.invoice_date || '–', due: m.invoice_date_due || '', owed: resid(m), late: lateBy(m.invoice_date_due) })).filter((r) => r.owed > 0.5);
  }, []);
  const pay = () => soft('pay', 'Supplier bills', async () => (await openMoves('in_invoice')).map((m) => ({ name: m.name, sup: nm(m.partner_id) || 'Unknown', due: m.invoice_date_due || '', owed: resid(m), late: lateBy(m.invoice_date_due) })).filter((r) => r.owed > 0.5), []);

  const po = () => soft('po', 'Purchase orders', async () => (await sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']], ['date_order', '>=', dt(lookStart)], ['date_order', '<=', dtEnd(e)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Purchase', limit: 20000 }))
    .map((o) => ({ name: o.name, sup: nm(o.partner_id) || 'Unknown', d: day(o.date_order), amount: n0(o.amount_total) })), []);

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
    const info = new Map(accs.map((a) => [a.id, { code: String(a.code || ''), name: a.name || '', cls: accountClass(Array.isArray(a[tf]) ? a[tf][1] : a[tf]) }]));
    const grp = async (extra) => {
      const r = await call(cfg, 'account.move.line', 'read_group', [[['parent_state', '=', 'posted'], ...extra], ['debit:sum', 'credit:sum'], ['account_id']], { lazy: false, context: { lang: 'en_US' } });
      const m = new Map();
      for (const g of r || []) { const id = nid(g.account_id); if (id) m.set(id, (m.get(id) || 0) + n0(g.debit) - n0(g.credit)); }
      return m;
    };
    const [now, prev, bal] = await Promise.all([grp([['date', '>=', s], ['date', '<=', e]]), grp([['date', '>=', ps], ['date', '<=', pe]]), grp([['date', '<=', e]])]);
    const tot = (m, c, sign) => { let t = 0; for (const [id, v] of m) if ((info.get(id) || {}).cls === c) t += v * sign; return t; };
    const I = tot(now, 'income', -1), C = tot(now, 'cogs', 1), X = tot(now, 'expense', 1), pI = tot(prev, 'income', -1), pC = tot(prev, 'cogs', 1), pX = tot(prev, 'expense', 1);
    const accRows = (c, sign) => [...new Set([...now.keys(), ...prev.keys()])].filter((id) => (info.get(id) || {}).cls === c)
      .map((id) => ({ code: info.get(id).code, name: info.get(id).name, now: (now.get(id) || 0) * sign, prev: (prev.get(id) || 0) * sign })).map((r) => ({ ...r, diff: r.now - r.prev })).sort((a, b) => b.now - a.now);
    const B = (c, sign) => tot(bal, c, sign);
    const profitToDate = B('income', -1) - B('cogs', 1) - B('expense', 1);
    const cash = B('cash', 1), recvB = B('recv', 1), curA = B('cur_asset', 1), fixedA = B('fixed_asset', 1), payB = B('payable', -1), curL = B('cur_liab', -1), longL = B('long_liab', -1), eq = B('equity', -1) + profitToDate, other = B('other', 1);
    return { I, C, X, gross: I - C, net: I - C - X, pI, pC, pX, pGross: pI - pC, pNet: pI - pC - pX, expRows: accRows('expense', 1), cogsRows: accRows('cogs', 1),
      cash, recvB, curA, fixedA, A: cash + recvB + curA + fixedA, payB, curL, longL, L: payB + curL + longL, eq, other };
  }, null);

  /* ---------- the model every card reads from ---------- */
  const model = () => once('model', async () => {
    const [O, L, R, P, PO, F, ST] = await Promise.all([orders(), lines(), recv(), pay(), po(), fin(), stock()]);
    const cur = O.filter((o) => inR(o.d, s, e)), prev = O.filter((o) => inR(o.d, ps, pe));
    const sales = sum(cur, 'net'), salesPrev = sum(prev, 'net'), salesGross = sum(cur, 'gross');
    const growth = salesPrev ? r1(((sales - salesPrev) / Math.abs(salesPrev)) * 100) : null;

    // customers over the look-back window
    const cm = new Map();
    for (const o of O) { const g = cm.get(o.cust) || { name: o.cust, first: o.d, last: o.d, n: 0, total: 0, cur: 0, prev: 0, rep: o.rep }; if (o.d < g.first) g.first = o.d; if (o.d >= g.last) { g.last = o.d; g.rep = o.rep; } g.n++; g.total += o.net; if (inR(o.d, s, e)) g.cur += o.net; if (inR(o.d, ps, pe)) g.prev += o.net; cm.set(o.cust, g); }
    const custs = [...cm.values()], repOfCust = new Map(custs.map((c) => [c.name, c.rep]));
    const curSet = new Set(cur.map((o) => o.cust)), active = custs.filter((c) => curSet.has(c.name)), activePrev = new Set(prev.map((o) => o.cust));
    const fresh = active.filter((c) => c.first >= s);
    const quiet = custs.filter((c) => c.n >= 2 && c.last < addDays(e, -QUIET_DAYS)).map((c) => ({ name: c.name, monthly: c.total / (lookDays / 30), silent: between(c.last, e), last: c.last, orders: c.n, rep: c.rep })).sort((a, b) => b.monthly - a.monthly);
    const byCur = active.slice().sort((a, b) => b.cur - a.cur);
    const topShare = sales > 0 && byCur.length ? pct(byCur[0].cur, sales) : 0, top3Share = sales > 0 ? pct(sum(byCur.slice(0, 3), 'cur'), sales) : 0;

    // receivables, by customer
    const owedTotal = sum(R, 'owed'), overdueList = R.filter((r) => r.late > 0), overdueTotal = sum(overdueList, 'owed');
    const dm = new Map();
    for (const r of R) { const g = dm.get(r.cust) || { name: r.cust, overdue: 0, owed: 0, oldest: 0, invoices: 0, rep: repOfCust.get(r.cust) || r.rep || '–', list: [] }; g.owed += r.owed; g.invoices++; if (r.late > 0) { g.overdue += r.owed; g.oldest = Math.max(g.oldest, r.late); } g.list.push(r); dm.set(r.cust, g); }
    const debtors = [...dm.values()].filter((g) => g.overdue > 0.5).sort((a, b) => b.overdue - a.overdue);
    const dso = salesGross > 0 ? owedTotal / (salesGross / days) : null;

    // salespeople
    const rm = new Map();
    const rep = (k) => { if (!rm.has(k)) rm.set(k, { name: k, sales: 0, prev: 0, orders: 0, custs: new Map(), overdue: 0 }); return rm.get(k); };
    for (const o of cur) { const g = rep(o.rep); g.sales += o.net; g.orders++; g.custs.set(o.cust, (g.custs.get(o.cust) || 0) + o.net); }
    for (const o of prev) rep(o.rep).prev += o.net;
    for (const d of debtors) if (rm.has(d.rep)) rm.get(d.rep).overdue += d.overdue;
    const reps = [...rm.values()].map((g) => ({ name: g.name, sales: g.sales, prev: g.prev, growth: g.prev ? r1(((g.sales - g.prev) / Math.abs(g.prev)) * 100) : null, orders: g.orders, customers: g.custs.size, avg: g.orders ? g.sales / g.orders : 0, share: sales ? pct(g.sales, sales) : 0, overdue: g.overdue,
      top: [...g.custs].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) })).sort((a, b) => b.sales - a.sales);
    const falling = reps.filter((r) => r.name !== 'No salesperson' && r.prev >= salesPrev * 0.05 && r.prev > 0 && r.growth !== null && r.growth <= -20).map((r) => ({ ...r, gap: r.prev - r.sales })).sort((a, b) => b.gap - a.gap);
    const unassigned = reps.find((r) => r.name === 'No salesperson');

    // payables and suppliers
    const payTotal = sum(P, 'owed'), payLate = sum(P.filter((p) => p.late > 0), 'owed'), week = addDays(today, 7), paySoon = sum(P.filter((p) => !p.late && p.due && p.due <= week), 'owed');
    const sm = new Map();
    for (const o of PO) { const g = sm.get(o.sup) || { name: o.sup, amount: 0, orders: 0, cur: 0, owed: 0 }; g.amount += o.amount; g.orders++; if (inR(o.d, s, e)) g.cur += o.amount; sm.set(o.sup, g); }
    for (const p of P) if (sm.has(p.sup)) sm.get(p.sup).owed += p.owed;
    const bought = sum(PO, 'amount'), suppliers = [...sm.values()].map((g) => ({ ...g, share: bought ? pct(g.amount, bought) : 0 })).sort((a, b) => b.amount - a.amount);

    // margin
    const known = L.filter((l) => l.cost !== null && l.rev > 0), knownRev = sum(known, 'rev'), knownCost = sum(known, 'cost'), allRev = sum(L, 'rev');
    const gm = knownRev ? pct(knownRev - knownCost, knownRev) : null;
    const unknown = L.filter((l) => l.cost === null && l.rev > 0), unknownRev = sum(unknown, 'rev');
    const leaks = gm === null ? [] : known.filter((l) => l.margin < 0 || (l.rev >= allRev * 0.01 && l.margin < gm - 8)).map((l) => ({ pid: l.pid, name: l.name, gain: (l.rev * (gm - l.margin)) / 100, margin: l.margin, rev: l.rev, unit: l.unit, units: l.units })).sort((a, b) => b.gain - a.gain);
    const outs = L.filter((l) => { const x = ST.get(l.pid); return x && x.storable && x.qty <= 0 && l.rev > 0; }).map((l) => ({ pid: l.pid, name: l.name, rev: l.rev, units: l.units, week: (l.rev / days) * 7 }));

    return { O, L, R, P, PO, F, cur, prev, sales, salesPrev, salesGross, growth, custs, active, activePrev, fresh, quiet, byCur, topShare, top3Share, owedTotal, overdueList, overdueTotal, debtors, dso, reps, falling, unassigned,
      payTotal, payLate, paySoon, suppliers, bought, known, gm, knownRev, knownCost, unknown, unknownRev, leaks, outs, allRev };
  });

  const names = (list, f, n = 3) => list.slice(0, n).map(f).join(', ') + (list.length > n ? ` and ${list.length - n} more` : '');
  const briefText = (goal, steps, back) => `Goal: ${goal}\n\nWhat to do:\n${steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nSend back: ${back}`;

  const actions = async () => {
    const m = await model(), out = [];
    const add = (a) => out.push(a);
    const debtCols = [COL.name('Customer'), COL.money('overdue', 'Overdue'), COL.int('oldest', 'Oldest, days late'), COL.int('invoices', 'Open invoices'), COL.str('rep', 'Salesperson')];

    if (m.overdueTotal > 0.5) {
      const share = pct(m.overdueTotal, m.owedTotal), worst = m.debtors[0];
      add({ tone: share >= 25 ? 'bad' : 'warn', area: 'Collections', tab: 'in', impact: m.overdueTotal, unit: 'cash to collect now',
        title: `Collect ${M(m.overdueTotal)} that is already overdue`,
        detail: `${m.debtors.length} customer${m.debtors.length === 1 ? ' is' : 's are'} past the due date, ${r1(share)}% of everything owed to you. Start with ${names(m.debtors, (d) => `${d.name} (${M(d.overdue)}, ${d.oldest} days late)`, 2)}.`,
        owner: worst && worst.rep !== '–' ? worst.rep : '',
        breakdown: bd([{ l: 'Overdue', v: m.overdueTotal, f: 'money' }, { l: 'Customers late', v: m.debtors.length, f: 'int' }, { l: 'Share of what is owed', v: share, f: 'pct' }], debtCols, m.debtors),
        brief: { title: 'Collect overdue invoices this week', body: briefText(`bring in ${M(m.overdueTotal)} of overdue customer invoices.`, [`Call these customers first: ${names(m.debtors, (d) => `${d.name} (${M(d.overdue)}, ${d.oldest} days late)`, 5)}.`, 'Agree a payment date with each one and write it down.', 'Hold new deliveries for anyone more than 60 days late until they pay or commit.'], 'a list with each customer, the amount, the promised payment date and anything blocking payment.') } });
    }
    if (m.quiet.length) {
      const at = sum(m.quiet, 'monthly');
      add({ tone: 'warn', area: 'Distributors', tab: 'distributors', impact: at, unit: 'sales per month at stake',
        title: `Win back ${m.quiet.length} distributor${m.quiet.length === 1 ? '' : 's'} who stopped ordering`,
        detail: `They ordered at least twice in the last ${Math.round(lookDays / 30)} months but nothing for ${QUIET_DAYS}+ days. Biggest: ${names(m.quiet, (q) => `${q.name} (${q.silent} days silent)`, 3)}.`,
        owner: m.quiet[0].rep !== 'No salesperson' ? m.quiet[0].rep : '',
        breakdown: bd([{ l: 'Distributors', v: m.quiet.length, f: 'int' }, { l: 'Usual sales per month', v: at, f: 'money' }], [COL.name('Distributor'), COL.money('monthly', 'Usual month'), COL.int('silent', 'Days silent'), COL.str('last', 'Last order'), COL.str('rep', 'Salesperson')], m.quiet),
        brief: { title: 'Call the distributors who stopped ordering', body: briefText(`get a new order from distributors who have gone quiet (worth about ${M(at)} a month).`, [`Contact: ${names(m.quiet, (q) => `${q.name} (last order ${q.last})`, 6)}.`, 'Ask why they stopped: stock left, price, a competitor, delivery or payment problems.', 'Offer the current promotion and take the order on the call if you can.'], 'for each distributor: the reason they stopped and the next order date or value.') } });
    }
    if (m.leaks.length) {
      const gain = sum(m.leaks, 'gain');
      add({ tone: m.leaks.some((l) => l.margin < 0) ? 'bad' : 'warn', area: 'Margin', tab: 'profit', impact: gain, unit: 'more profit this period at your average margin',
        title: `Fix the margin on ${m.leaks.length} product${m.leaks.length === 1 ? '' : 's'}`,
        detail: `Your average gross margin is ${r1(m.gm)}%. These sell well but earn much less: ${names(m.leaks, (l) => `${l.name.replace(/^\s*\[[^\]]*\]\s*/, '')} (${r1(l.margin)}%)`, 3)}. Raise the price, trim the offer or cut the cost.`,
        breakdown: bd([{ l: 'Average margin', v: m.gm, f: 'pct' }, { l: 'Profit left on the table', v: gain, f: 'money' }], [COL.name('Product'), COL.money('gain', 'Profit left'), COL.pct('margin', 'Margin'), COL.money('rev', 'Sales'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }], m.leaks),
        brief: { title: 'Review prices on our lowest-margin products', body: briefText(`lift the margin on products earning well below our ${r1(m.gm)}% average.`, [`Review: ${names(m.leaks, (l) => `${l.name} (${r1(l.margin)}% margin)`, 6)}.`, 'For each one propose a new price, a smaller discount or a cheaper pack, with the expected margin.', 'Check the cost in Odoo is right before changing a price.'], 'a table with product, current price, proposed price and new margin.') } });
    }
    if (m.outs.length) {
      const wk = sum(m.outs, 'week');
      add({ tone: 'bad', area: 'Stock', tab: 'finished', impact: wk, unit: 'sales at risk every week',
        title: `Restock ${m.outs.length} selling product${m.outs.length === 1 ? '' : 's'} now at zero`,
        detail: `They sold in this period and Odoo shows none on hand: ${names(m.outs, (o) => o.name.replace(/^\s*\[[^\]]*\]\s*/, ''), 3)}.`,
        breakdown: bd([{ l: 'Products', v: m.outs.length, f: 'int' }], [COL.name('Product'), COL.money('rev', 'Sold this period'), COL.int('units', 'Units'), COL.money('week', 'Sales per week')], m.outs),
        brief: { title: 'Restock products that are out of stock', body: briefText('get our selling products back in stock.', [`Out of stock now: ${names(m.outs, (o) => o.name, 8)}.`, 'Confirm the real count in the warehouse against Odoo.', 'Give the date each one will be available again and what is needed to make it happen.'], 'product, real quantity, date back in stock.') } });
    }
    if (m.falling.length) {
      const gap = sum(m.falling, 'gap');
      add({ tone: 'warn', area: 'Salespeople', tab: 'people', impact: gap, unit: `less than ${ctx.compareText || 'the period before'}`,
        title: m.falling.length === 1 ? `${m.falling[0].name} is selling ${Math.abs(m.falling[0].growth)}% less` : `${m.falling.length} salespeople are selling less than before`,
        detail: `${names(m.falling, (r) => `${r.name} ${r.growth}% (${M(r.sales)} against ${M(r.prev)})`, 3)}. Check which of their customers did not reorder.`,
        owner: m.falling[0].name,
        breakdown: bd([{ l: 'Sales gap', v: gap, f: 'money' }], [COL.name('Salesperson'), COL.money('sales', 'This period'), COL.money('prev', 'Before'), { key: 'growth', label: 'Change', fmt: 'growth' }, COL.int('customers', 'Customers')], m.falling),
        brief: { title: 'Sales recovery plan', body: briefText(`recover ${M(gap)} of sales lost against ${ctx.compareText || 'the period before'}.`, ['List the customers who bought before and have not ordered in this period.', 'Call each one this week and record the outcome.', 'Name the three biggest deals you can close before the end of the month.'], 'the customer list with call results and expected order values.') } });
    }
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
    if (m.suppliers.length > 1 && m.suppliers[0].share >= 40) add({ tone: 'info', area: 'Suppliers', tab: 'suppliers', impact: null, title: `${m.suppliers[0].name} supplies ${r1(m.suppliers[0].share)}% of what you buy`, detail: `That is ${M(m.suppliers[0].amount)} in ${Math.round(lookDays / 30)} months. Get a second quote for their main items: it protects supply and gives you room to negotiate.`,
      brief: { title: 'Get a second supplier quote', body: briefText(`reduce our dependence on ${m.suppliers[0].name} and check we pay a fair price.`, ['List the five items we buy most from this supplier, with quantity and current price.', 'Get written quotes for the same items from two other suppliers.', 'Compare price, payment terms and delivery time.'], 'a comparison table and your recommendation.') } });
    if (m.unknown.length) add({ tone: 'info', area: 'Margin', tab: 'profit', impact: null, title: `Set a cost on ${m.unknown.length} product${m.unknown.length === 1 ? '' : 's'} in Odoo`, detail: `${M(m.unknownRev)} of sales (${r1(pct(m.unknownRev, m.allRev))}%) has no cost, so its profit is invisible here: ${names(m.unknown, (l) => l.name.replace(/^\s*\[[^\]]*\]\s*/, ''), 3)}.` });
    if (m.unassigned && m.unassigned.share >= 10) add({ tone: 'info', area: 'Salespeople', tab: 'people', impact: null, title: `${r1(m.unassigned.share)}% of sales has no salesperson on the order`, detail: `${M(m.unassigned.sales)} across ${m.unassigned.orders} order${m.unassigned.orders === 1 ? '' : 's'} cannot be credited to anyone. Make the Salesperson field required on sales orders in Odoo.` });
    if (m.fresh.length) add({ tone: 'good', area: 'Distributors', tab: 'distributors', impact: sum(m.fresh, 'cur'), unit: 'from new or returning customers', title: `${m.fresh.length} new or returning customer${m.fresh.length === 1 ? '' : 's'} ordered`, detail: `No order from them in the ${Math.round(lookDays / 30)} months before: ${names(m.fresh.slice().sort((a, b) => b.cur - a.cur), (c) => `${c.name} (${M(c.cur)})`, 3)}. Follow up early so they reorder.` });
    const star = m.reps.filter((r) => r.name !== 'No salesperson' && r.growth !== null && r.growth >= 15 && r.share >= 5).sort((a, b) => (b.sales - b.prev) - (a.sales - a.prev))[0];
    if (star) add({ tone: 'good', area: 'Salespeople', tab: 'people', impact: star.sales - star.prev, unit: `more than ${ctx.compareText || 'the period before'}`, title: `${star.name} is up ${star.growth}%`, detail: `${M(star.sales)} from ${star.orders} order${star.orders === 1 ? '' : 's'} and ${star.customers} customer${star.customers === 1 ? '' : 's'}. Find out what they are doing and share it with the team.` });

    const rank = (a) => (a.tone === 'good' ? 2 : a.impact === null ? 1 : 0);
    out.sort((a, b) => rank(a) - rank(b) || (b.impact || 0) - (a.impact || 0));

    const parts = [];
    if (m.growth !== null) parts.push({ l: 'Sales growth', v: clamp((m.growth + 20) / 40), t: `${m.growth >= 0 ? '+' : ''}${m.growth}% against ${ctx.compareText || 'the period before'}` });
    if (m.gm !== null) parts.push({ l: 'Gross margin', v: clamp(m.gm / 45), t: `${r1(m.gm)}% on products with a cost` });
    if (m.owedTotal > 0) parts.push({ l: 'Collections', v: clamp(1 - m.overdueTotal / m.owedTotal), t: `${r1(pct(m.overdueTotal, m.owedTotal))}% of what customers owe is overdue` });
    if (m.F && m.F.payB + m.F.curL > 0) { const cr = (m.F.cash + m.F.recvB + m.F.curA) / (m.F.payB + m.F.curL); parts.push({ l: 'Liquidity', v: clamp((cr - 0.5) / 1.5), t: `${cr.toFixed(2)} of short-term assets for every 1 owed short-term` }); }
    if (m.sales > 0 && m.byCur.length) parts.push({ l: 'Customer spread', v: clamp(1 - (m.topShare - 10) / 40), t: `biggest customer is ${r1(m.topShare)}% of sales` });
    const score = parts.length ? Math.round((parts.reduce((a, p) => a + p.v, 0) / parts.length) * 100) : null;
    return { items: out, score, parts, gaps: [...new Set(gaps)] };
  };

  const tiles = async () => {
    const m = await model(), F = m.F, T = [];
    T.push(tile('Net sales', m.sales, 'money', { prev: m.salesPrev, sub: `${m.cur.length} orders · ${m.active.length} customers`, daily: daily(ctx, m.cur, m.prev, (o) => o.d, (o) => o.net),
      breakdown: bd([{ l: 'Orders', v: m.cur.length, f: 'int' }, { l: 'Customers', v: m.active.length, f: 'int' }, { l: 'Average order', v: m.cur.length ? m.sales / m.cur.length : 0, f: 'money' }], [COL.name('Customer'), COL.money('cur', 'Sales'), COL.money('prev', 'Before'), COL.str('rep', 'Salesperson')], m.byCur) }));
    if (m.gm !== null) T.push(tile('Gross margin', m.gm, 'pct', { sub: `${M(m.knownRev - m.knownCost)} gross profit` + (m.unknown.length ? ` · ${m.unknown.length} products without a cost` : '') }));
    if (F) T.push(tile('Net profit', F.net, 'money', { prev: F.pNet, sub: F.I ? `${r1(pct(F.net, F.I))}% of revenue in the books` : 'from the posted journals',
      breakdown: { summary: [{ l: 'Revenue', v: F.I, f: 'money' }, { l: 'Cost of revenue', v: F.C, f: 'money' }, { l: 'Expenses', v: F.X, f: 'money' }], columns: [{ key: 'step', label: 'Step', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }], rows: [{ step: 'Revenue', amount: F.I }, { step: 'Cost of revenue', amount: -F.C }, { step: 'Expenses', amount: -F.X }, { step: 'Net profit', amount: F.net }], more: 0 } }));
    if (F) { const burn = (F.C + F.X) / days; T.push(tile('Cash and bank', F.cash, 'money', { sub: burn > 0 ? `covers ${Math.max(0, Math.round(F.cash / burn))} days of costs` : `on ${e}` })); }
    T.push(tile('Customers owe you', m.owedTotal, 'money', { goodDown: true, sub: `${M(m.overdueTotal)} overdue` + (m.dso !== null ? ` · ${Math.round(m.dso)} days of sales` : ''),
      breakdown: bd([{ l: 'Open invoices', v: m.R.length, f: 'int' }, { l: 'Overdue', v: m.overdueTotal, f: 'money' }], [COL.name('Invoice'), COL.str('cust', 'Customer'), COL.str('due', 'Due'), COL.money('owed', 'Still owed'), COL.int('late', 'Days late')], m.R.slice().sort((a, b) => b.owed - a.owed)) }));
    T.push(tile('You owe suppliers', m.payTotal, 'money', { goodDown: true, sub: `${M(m.payLate)} overdue · ${M(m.paySoon)} due in 7 days`,
      breakdown: bd([{ l: 'Open bills', v: m.P.length, f: 'int' }], [COL.name('Bill'), COL.str('sup', 'Supplier'), COL.str('due', 'Due'), COL.money('owed', 'Still to pay'), COL.int('late', 'Days late')], m.P.slice().sort((a, b) => b.owed - a.owed)) }));
    T.push(tile('Active distributors', m.active.length, 'int', { prev: m.activePrev.size, sub: `${m.fresh.length} new or back · ${m.quiet.length} gone quiet` }));
    if (F && F.payB + F.curL > 0) T.push(tile('Short-term cover', (F.cash + F.recvB + F.curA) / (F.payB + F.curL), 'x', { sub: 'short-term assets ÷ short-term debts (above 1.5× is comfortable)' }));
    return { tiles: T };
  };

  const stmt = (style, code, name, now, prev) => ({ style, code, name, now, prev, chg: prev ? r1(((now - prev) / Math.abs(prev)) * 100) : null });
  return [
    section('actions', `What to do now, ranked by money (${ctx.monthLabel})`, 'actions', actions),
    section('kpi', `The business at a glance (${ctx.monthLabel})`, 'kpi', tiles, 'Click a card to see what is behind it. Sales are confirmed orders before tax; net profit, cash and cover come from the posted journals.'),
    section('reps', `Salespeople scoreboard (${ctx.monthLabel})`, 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Salesperson'), { key: 'sales', label: 'Sales', fmt: 'money', bar: true }, { key: 'growth', label: 'Change', fmt: 'growth' }, COL.int('orders', 'Orders'), COL.int('customers', 'Customers'), COL.money('avg', 'Average order'), COL.pct('share', 'Share'), COL.money('overdue', 'Overdue from their customers')],
        rows: m.reps.filter((r) => r.sales || r.prev).map((r) => ({ name: r.name, sales: r.sales, growth: r.growth, orders: r.orders, customers: r.customers, avg: r.avg, share: r.share, overdue: r.overdue,
          breakdown: bd([{ l: 'Customers', v: r.customers, f: 'int' }, { l: 'Before', v: r.prev, f: 'money' }], [COL.name('Customer'), COL.money('value', 'Sales')], r.top) })), empty: 'No confirmed orders in this period.' };
    }, 'Sales next to the money their customers still owe past the due date, so selling and collecting are seen together. Click a name for their customers.'),
    section('quiet', 'Distributors who stopped ordering', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Distributor'), { key: 'monthly', label: 'Usual month', fmt: 'money', bar: true }, COL.int('silent', 'Days silent'), COL.str('last', 'Last order'), COL.int('orders', 'Orders before'), COL.str('rep', 'Salesperson')], rows: m.quiet.slice(0, 200), empty: `Every regular distributor ordered in the last ${QUIET_DAYS} days.` };
    }, `Ordered at least twice in the last ${Math.round(lookDays / 30)} months, then nothing for ${QUIET_DAYS} days or more. "Usual month" is their average over that time.`),
    section('collect', 'Who to collect from first', 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Customer'), { key: 'overdue', label: 'Overdue', fmt: 'money', bar: true }, COL.int('oldest', 'Oldest, days late'), COL.int('invoices', 'Open invoices'), COL.money('owed', 'Total owed'), COL.str('rep', 'Salesperson')],
        rows: m.debtors.slice(0, 200).map((d) => ({ name: d.name, overdue: d.overdue, oldest: d.oldest, invoices: d.invoices, owed: d.owed, rep: d.rep,
          breakdown: bd([{ l: 'Overdue', v: d.overdue, f: 'money' }, { l: 'Total owed', v: d.owed, f: 'money' }], [COL.name('Invoice'), COL.str('date', 'Date'), COL.str('due', 'Due'), COL.money('owed', 'Still owed'), COL.int('late', 'Days late')], d.list.slice().sort((a, b) => b.late - a.late)) })), empty: 'Nothing is overdue.' };
    }, 'Unpaid invoices past their due date, biggest first. The salesperson is the one on the customer\'s latest order.'),
    section('leaks', `Products earning less than they should (${ctx.monthLabel})`, 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Product'), { key: 'gain', label: 'Profit left on the table', fmt: 'money', bar: true }, COL.pct('margin', 'Margin'), COL.money('rev', 'Sales'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.int('units', 'Units')], rows: m.leaks.slice(0, 100), empty: m.gm === null ? 'No product has a cost set in Odoo, so margins cannot be worked out.' : 'No selling product is far below your average margin.' };
    }, 'Products at least 8 points under your average gross margin, or sold at a loss. "Profit left" is what they would add at the average margin.'),
    section('suppliers', `Supplier dependence (last ${Math.round(lookDays / 30)} months)`, 'table', async () => {
      const m = await model();
      return { initial: 10, columns: [COL.name('Supplier'), { key: 'amount', label: 'Bought', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('orders', 'Orders'), COL.money('cur', 'This period'), COL.money('owed', 'You owe them')], rows: m.suppliers.slice(0, 100), empty: 'No purchase orders in this time.' };
    }, 'Confirmed purchase orders. A supplier above 40% of your buying is a risk worth a second quote.'),
    section('pl', `Profit and loss in one look (${ctx.monthLabel})`, 'table', async () => {
      const F = (await model()).F; if (!F) throw new Error('Accounting could not be read, so there is no profit and loss here.');
      const top = F.expRows.filter((r) => Math.abs(r.now) >= 0.5 || Math.abs(r.prev) >= 0.5).slice(0, 8), rest = F.X - sum(top, 'now'), restP = F.pX - sum(top, 'prev');
      return { columns: [COL.str('code', 'Code'), COL.str('name', 'Line'), COL.money('now', 'This period'), COL.money('prev', 'Compared period'), { key: 'chg', label: 'Change', fmt: 'growth' }],
        rows: [stmt('total', '', 'Revenue', F.I, F.pI), stmt('line', '', 'Cost of revenue', F.C, F.pC), stmt('total', '', 'Gross profit', F.gross, F.pGross), stmt('head', '', 'Expenses', F.X, F.pX), ...top.map((r) => stmt('line', r.code, r.name, r.now, r.prev)), ...(Math.abs(rest) >= 0.5 || Math.abs(restP) >= 0.5 ? [stmt('line', '', 'All other expenses', rest, restP)] : []), stmt('total', '', 'Net profit', F.net, F.pNet)] };
    }, 'From the posted journal entries. The full statement, account by account, is under Finance, Profit & loss.'),
    section('bs', `Balance sheet in one look (on ${e})`, 'table', async () => {
      const F = (await model()).F; if (!F) throw new Error('Accounting could not be read, so there is no balance sheet here.');
      const row = (style, name, amount) => ({ style, code: '', name, amount, share: F.A ? pct(amount, F.A) : null });
      return { columns: [COL.str('code', ''), COL.str('name', 'Line'), COL.money('amount', 'Amount'), COL.pct('share', 'Of total assets')],
        rows: [row('head', 'What you own', F.A), row('line', 'Cash and bank', F.cash), row('line', 'Customers owe you', F.recvB), row('line', 'Stock and other short-term assets', F.curA), row('line', 'Equipment and long-term assets', F.fixedA), row('total', 'Total assets', F.A),
          row('head', 'What you owe', F.L), row('line', 'Suppliers', F.payB), row('line', 'Other short-term debts', F.curL), row('line', 'Long-term debts', F.longL), row('total', 'Total liabilities', F.L),
          row('total', 'Equity (yours), including profit to date', F.eq), ...(Math.abs(F.other) >= 0.5 ? [row('line', 'Accounts with an unrecognised type', F.other)] : [])] };
    }, 'Every posted entry up to the last day chosen. The full balance sheet is under Finance, Balance sheet.'),
  ];
}
