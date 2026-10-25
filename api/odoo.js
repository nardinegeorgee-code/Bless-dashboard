import { route, allow, requireAdmin } from './_lib.js';
import { odooConfig, odooVersion, call, sr, nm, nid, fieldsOf, needModel } from './_odoo.js';

const TABS = ['inventory', 'sales', 'accounting', 'hr'];
const pad = (n) => String(n).padStart(2, '0');
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const sum = (rows, f) => rows.reduce((a, r) => a + n0(typeof f === 'function' ? f(r) : r[f]), 0);
const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthsBack = (n) => { const now = new Date(); const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1)); } return out; };
const range = (key) => { const [y, m] = key.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { s: `${key}-01`, e: `${key}-${pad(last)}` }; };
const prevKey = (key) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };
const mkey = (s) => String(s || '').slice(0, 7);
const dt = (d) => d + ' 00:00:00', dtEnd = (d) => d + ' 23:59:59';

const section = (id, title, kind, fn, note) => async () => {
  try { return { id, title, kind, note, ...(await fn()) }; }
  catch (e) { return { id, title, kind, note, error: String(e.message || e).slice(0, 400) }; }
};
const tile = (label, value, fmt, extra = {}) => ({ label, value, fmt, ...extra });
const rows = (r, limit) => r.slice(0, limit);

/* ---------- tabs ---------- */
function build(tab, cfg, ctx) {
  const { month, s, e, ps, pe, today } = ctx;
  const memo = {};
  const once = (k, fn) => (memo[k] = memo[k] || fn());

  const products = () => once('products', async () => {
    const f = await needModel(cfg, 'product.product', 'Inventory');
    const list = await sr(cfg, 'product.product', [['active', '=', true]], ['display_name', 'default_code', 'qty_available', 'virtual_available', 'standard_price', 'list_price', 'categ_id', 'type', 'is_storable'], { limit: 5000 });
    const storable = list.filter((p) => (f.has('is_storable') ? p.is_storable : p.type === 'product'));
    let mins = new Map();
    try {
      const ops = await sr(cfg, 'stock.warehouse.orderpoint', [], ['product_id', 'product_min_qty'], { limit: 5000 });
      ops.forEach((o) => mins.set(nid(o.product_id), Math.max(mins.get(nid(o.product_id)) || 0, n0(o.product_min_qty))));
    } catch (err) { mins = new Map(); }
    return { storable, mins };
  });

  if (tab === 'inventory') return [
    section('kpi', 'Stock at a glance', 'kpi', async () => {
      const { storable, mins } = await products();
      const cost = (p) => Math.max(0, n0(p.qty_available)) * n0(p.standard_price);
      const out = storable.filter((p) => n0(p.qty_available) <= 0);
      const low = storable.filter((p) => n0(p.qty_available) > 0 && n0(p.qty_available) <= (mins.get(p.id) ?? 5));
      const po = await sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']], ['date_order', '>=', dt(s)], ['date_order', '<=', dtEnd(e)]], ['amount_total'], { app: 'Purchase', limit: 5000 }).catch(() => null);
      return { tiles: [
        tile('Stocked products', storable.length, 'int'),
        tile('Stock value (at cost)', sum(storable, cost), 'money'),
        tile('Stock value (at sale price)', sum(storable, (p) => Math.max(0, n0(p.qty_available)) * n0(p.list_price)), 'money'),
        tile('Out of stock', out.length, 'int', { goodDown: true, sub: pct(out.length, storable.length).toFixed(0) + '% of stocked products' }),
        tile('Running low', low.length, 'int', { goodDown: true, sub: mins.size ? 'at or under the reorder minimum' : 'at 5 units or fewer' }),
        ...(po ? [tile('Purchased this month', sum(po, 'amount_total'), 'money', { sub: po.length + ' purchase orders' })] : []),
      ] };
    }),
    section('attention', 'Needs restocking', 'table', async () => {
      const { storable, mins } = await products();
      const list = storable.filter((p) => n0(p.qty_available) <= (mins.get(p.id) ?? 5))
        .sort((a, b) => n0(a.qty_available) - n0(b.qty_available)).slice(0, 15)
        .map((p) => ({ name: p.display_name, qty: n0(p.qty_available), incoming: Math.max(0, n0(p.virtual_available) - n0(p.qty_available)), min: mins.get(p.id) ?? 5 }));
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'qty', label: 'On hand', fmt: 'int', bar: true, barReverse: true }, { key: 'incoming', label: 'Arriving', fmt: 'int' }, { key: 'min', label: 'Minimum', fmt: 'int' }], rows: list, empty: 'Nothing is running low.' };
    }, 'Products at or under their reorder minimum (5 units when no minimum is set in Odoo).'),
    section('value', 'Where your money is sitting in stock', 'table', async () => {
      const { storable } = await products();
      const list = storable.map((p) => ({ name: p.display_name, value: Math.max(0, n0(p.qty_available)) * n0(p.standard_price), qty: n0(p.qty_available), cost: n0(p.standard_price) }))
        .filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 15);
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'value', label: 'Stock value', fmt: 'money', bar: true }, { key: 'qty', label: 'On hand', fmt: 'int' }, { key: 'cost', label: 'Unit cost', fmt: 'money' }], rows: list, empty: 'No stock value yet. Set a cost on your products in Odoo.' };
    }),
    section('cat', 'Stock by category', 'table', async () => {
      const { storable } = await products();
      const m = new Map();
      for (const p of storable) { const k = nm(p.categ_id) || 'No category'; const g = m.get(k) || { name: k, value: 0, products: 0, units: 0 }; g.value += Math.max(0, n0(p.qty_available)) * n0(p.standard_price); g.products++; g.units += Math.max(0, n0(p.qty_available)); m.set(k, g); }
      return { columns: [{ key: 'name', label: 'Category', fmt: 'str' }, { key: 'value', label: 'Stock value', fmt: 'money', bar: true }, { key: 'products', label: 'Products', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 15) };
    }),
    section('po', 'Purchase orders still to receive', 'table', async () => {
      const f = await needModel(cfg, 'purchase.order', 'Purchase');
      const list = await sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']]], ['name', 'partner_id', 'amount_total', 'date_planned', 'receipt_status'], { app: 'Purchase', order: 'date_planned asc', limit: 500 });
      const open = list.filter((o) => (f.has('receipt_status') ? o.receipt_status !== 'full' : true)).slice(0, 15);
      return { columns: [{ key: 'name', label: 'Order', fmt: 'str' }, { key: 'amount', label: 'Value', fmt: 'money', bar: true }, { key: 'due', label: 'Expected', fmt: 'str' }, { key: 'status', label: 'Status', fmt: 'str' }],
        rows: open.map((o) => ({ name: `${o.name} · ${nm(o.partner_id)}`, amount: n0(o.amount_total), due: String(o.date_planned || '').slice(0, 10) || '–', status: o.receipt_status ? String(o.receipt_status).replace(/_/g, ' ') : 'open' })), empty: 'Nothing waiting to be received.' };
    }),
  ];

  const invoices = (types, extra = []) => sr(cfg, 'account.move', [['move_type', 'in', types], ['state', '=', 'posted'], ...extra],
    ['name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due', 'amount_total_signed', 'amount_residual_signed', 'amount_residual', 'payment_state'], { app: 'Accounting', limit: 20000 });
  const sign = (m) => (m.move_type === 'out_refund' || m.move_type === 'in_refund' ? -1 : 1);
  const amt = (m) => sign(m) * Math.abs(n0(m.amount_total_signed));
  const resid = (m) => Math.abs(n0(m.amount_residual_signed ?? m.amount_residual));
  const unpaid = (m) => m.payment_state === 'not_paid' || m.payment_state === 'partial' || m.payment_state === 'in_payment' && false;
  const trend12 = async (series) => {
    const m12 = monthsBack(12); const start = m12[0] + '-01';
    const data = {}; for (const [id, fetch, val] of series) data[id] = await fetch(start);
    return { rows: m12.map((k) => ({ key: k, label: label(k), values: Object.fromEntries(series.map(([id, , val]) => [id, sum(data[id].filter((r) => mkey(r._d) === k), val)])) })), selectable: true };
  };

  if (tab === 'sales') return [
    section('kpi', `Sales in ${ctx.monthLabel}`, 'kpi', async () => {
      const so = (a, b, st) => sr(cfg, 'sale.order', [['state', 'in', st], ['date_order', '>=', dt(a)], ['date_order', '<=', dtEnd(b)]], ['amount_total'], { app: 'Sales', limit: 20000 });
      const [cur, prev, quotes, inv, pinv, open] = await Promise.all([
        so(s, e, ['sale', 'done']), so(ps, pe, ['sale', 'done']), so(s, e, ['draft', 'sent']),
        invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', s], ['invoice_date', '<=', e]]), invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', ps], ['invoice_date', '<=', pe]]),
        invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]),
      ]);
      const overdue = open.filter((m) => m.invoice_date_due && m.invoice_date_due < today);
      return { tiles: [
        tile('Confirmed orders', cur.length, 'int', { prev: (await so(ps, pe, ['sale', 'done'])).length }),
        tile('Order value', sum(cur, 'amount_total'), 'money', { prev: sum(prev, 'amount_total') }),
        tile('Open quotations', quotes.length, 'int', { sub: 'worth ' + Math.round(sum(quotes, 'amount_total')).toLocaleString() }),
        tile('Invoiced', sum(inv, amt), 'money', { prev: sum(pinv, amt) }),
        tile('Waiting to be paid', sum(open, resid), 'money', { goodDown: true, sub: open.length + ' invoices' }),
        tile('Overdue', sum(overdue, resid), 'money', { goodDown: true, sub: overdue.length + ' invoices past their due date' }),
      ] };
    }),
    section('trend', 'Last 12 months', 'trend', async () => {
      const t = await trend12([
        ['orders', async (start) => (await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['date_order', 'amount_total'], { app: 'Sales', limit: 20000 })).map((r) => ({ ...r, _d: r.date_order })), 'amount_total'],
        ['invoiced', async (start) => (await invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
      ]);
      return { ...t, metrics: [{ key: 'orders', label: 'Order value', fmt: 'money' }, { key: 'invoiced', label: 'Invoiced', fmt: 'money' }] };
    }),
    section('customers', `Top customers (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(s)], ['date_order', '<=', dtEnd(e)]], ['partner_id', 'amount_total'], { app: 'Sales', limit: 20000 });
      const m = new Map(); list.forEach((o) => { const k = nm(o.partner_id) || 'Unknown'; const g = m.get(k) || { name: k, value: 0, orders: 0 }; g.value += n0(o.amount_total); g.orders++; m.set(k, g); });
      return { columns: [{ key: 'name', label: 'Customer', fmt: 'str' }, { key: 'value', label: 'Order value', fmt: 'money', bar: true }, { key: 'orders', label: 'Orders', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10), empty: 'No confirmed orders this month.' };
    }),
    section('products', `Top products sold (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(s)], ['order_id.date_order', '<=', dtEnd(e)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 20000 });
      const m = new Map(); list.forEach((l) => { const k = nm(l.product_id) || 'Other'; const g = m.get(k) || { name: k, value: 0, units: 0 }; g.value += n0(l.price_subtotal); g.units += n0(l.product_uom_qty); m.set(k, g); });
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'value', label: 'Sales (before tax)', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10), empty: 'No sales lines this month.' };
    }),
    section('overdue', 'Overdue invoices to chase', 'table', async () => {
      const list = (await invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']], ['invoice_date_due', '<', today]])).sort((a, b) => resid(b) - resid(a)).slice(0, 12);
      const days = (d) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000));
      return { columns: [{ key: 'name', label: 'Invoice', fmt: 'str' }, { key: 'amount', label: 'Still owed', fmt: 'money', bar: true }, { key: 'late', label: 'Days late', fmt: 'days' }], rows: list.map((m) => ({ name: `${m.name} · ${nm(m.partner_id)}`, amount: resid(m), late: days(m.invoice_date_due) })), empty: 'Nothing is overdue.' };
    }),
  ];

  if (tab === 'accounting') return [
    section('kpi', `Money in and out (${ctx.monthLabel})`, 'kpi', async () => {
      const get = (a, b) => Promise.all([invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', a], ['invoice_date', '<=', b]]), invoices(['in_invoice', 'in_refund'], [['invoice_date', '>=', a], ['invoice_date', '<=', b]])]);
      const [[inn, out], [pin, pout]] = await Promise.all([get(s, e), get(ps, pe)]);
      const [recv, pay] = await Promise.all([invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]), invoices(['in_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]])]);
      const money = (a, b, dir) => sr(cfg, 'account.payment', [['payment_type', '=', dir], ['state', 'in', ['posted', 'paid']], ['date', '>=', a], ['date', '<=', b]], ['amount'], { app: 'Accounting', limit: 20000 }).then((r) => sum(r, 'amount')).catch(() => null);
      const [pr, ps2] = await Promise.all([money(s, e, 'inbound'), money(s, e, 'outbound')]);
      return { tiles: [
        tile('Invoiced to customers', sum(inn, amt), 'money', { prev: sum(pin, amt) }),
        tile('Bills from suppliers', sum(out, amt), 'money', { prev: sum(pout, amt), goodDown: true }),
        tile('Difference', sum(inn, amt) - sum(out, amt), 'money', { prev: sum(pin, amt) - sum(pout, amt), sub: 'invoiced minus bills' }),
        tile('Customers owe you', sum(recv, resid), 'money', { sub: recv.length + ' open invoices' }),
        tile('You owe suppliers', sum(pay, resid), 'money', { goodDown: true, sub: pay.length + ' open bills' }),
        ...(pr !== null ? [tile('Payments received', pr, 'money'), tile('Payments sent', ps2, 'money')] : []),
      ] };
    }, 'These are invoices and bills posted in Odoo. A full profit and loss needs your chart of accounts; ask and I will add it.'),
    section('trend', 'Last 12 months', 'trend', async () => {
      const t = await trend12([
        ['in', async (start) => (await invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
        ['out', async (start) => (await invoices(['in_invoice', 'in_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
      ]);
      t.rows.forEach((r) => { r.values.net = r.values.in - r.values.out; });
      return { ...t, metrics: [{ key: 'in', label: 'Invoiced to customers', fmt: 'money' }, { key: 'out', label: 'Bills from suppliers', fmt: 'money' }, { key: 'net', label: 'Difference', fmt: 'money' }] };
    }),
    section('aging', 'Who owes you, by how late', 'table', async () => {
      const open = await invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]);
      const b = [['Not due yet', -Infinity, 0], ['1 to 30 days late', 0, 30], ['31 to 60 days late', 30, 60], ['61 to 90 days late', 60, 90], ['Over 90 days late', 90, Infinity]].map(([name, lo, hi]) => ({ name, lo, hi, value: 0, count: 0 }));
      open.forEach((m) => { const late = m.invoice_date_due ? (Date.parse(today) - Date.parse(m.invoice_date_due)) / 86400000 : 0; const g = b.find((x) => late > x.lo && late <= x.hi) || b[0]; g.value += resid(m); g.count++; });
      return { columns: [{ key: 'name', label: 'Age', fmt: 'str' }, { key: 'value', label: 'Amount', fmt: 'money', bar: true }, { key: 'count', label: 'Invoices', fmt: 'int' }], rows: b };
    }),
    section('bills', 'Biggest bills you still have to pay', 'table', async () => {
      const list = (await invoices(['in_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]])).sort((a, b) => resid(b) - resid(a)).slice(0, 12);
      return { columns: [{ key: 'name', label: 'Bill', fmt: 'str' }, { key: 'amount', label: 'Still to pay', fmt: 'money', bar: true }, { key: 'due', label: 'Due', fmt: 'str' }], rows: list.map((m) => ({ name: `${m.name} · ${nm(m.partner_id)}`, amount: resid(m), due: m.invoice_date_due || '–' })), empty: 'No unpaid bills.' };
    }),
    section('expenses', `Employee expenses (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'hr.expense', [['date', '>=', s], ['date', '<=', e]], ['name', 'employee_id', 'total_amount', 'state'], { app: 'Expenses', limit: 5000 });
      const m = new Map(); list.forEach((x) => { const k = nm(x.employee_id) || 'Unknown'; const g = m.get(k) || { name: k, value: 0, count: 0 }; g.value += n0(x.total_amount); g.count++; m.set(k, g); });
      return { columns: [{ key: 'name', label: 'Employee', fmt: 'str' }, { key: 'value', label: 'Expenses', fmt: 'money', bar: true }, { key: 'count', label: 'Claims', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10), empty: 'No expenses this month.' };
    }),
  ];

  if (tab === 'hr') {
    const emps = () => once('emps', () => sr(cfg, 'hr.employee', [['active', '=', true]], ['name', 'department_id', 'job_id', 'parent_id'], { app: 'Employees', limit: 5000 }));
    return [
      section('kpi', `Team at a glance (${ctx.monthLabel})`, 'kpi', async () => {
        const list = await emps();
        const depts = new Set(list.map((x) => nm(x.department_id)).filter(Boolean));
        const att = await sr(cfg, 'hr.attendance', [['check_in', '>=', dt(s)], ['check_in', '<=', dtEnd(e)]], ['employee_id', 'worked_hours'], { app: 'Attendances', limit: 20000 }).catch(() => null);
        const leave = await sr(cfg, 'hr.leave', [['state', '=', 'validate'], ['date_from', '<=', dtEnd(e)], ['date_to', '>=', dt(s)]], ['number_of_days'], { app: 'Time Off', limit: 5000 }).catch(() => null);
        const hours = att ? sum(att, 'worked_hours') : null;
        return { tiles: [
          tile('Employees', list.length, 'int'), tile('Departments', depts.size, 'int'),
          ...(att ? [tile('Hours worked', hours, 'num1', { sub: att.length + ' check-ins' }), tile('Average per employee', list.length ? hours / list.length : 0, 'num1', { sub: 'hours this month' })] : []),
          ...(leave ? [tile('Approved time off', sum(leave, 'number_of_days'), 'num1', { sub: 'days touching this month' })] : []),
        ] };
      }),
      section('dept', 'People by department', 'table', async () => {
        const m = new Map(); (await emps()).forEach((x) => { const k = nm(x.department_id) || 'No department'; m.set(k, (m.get(k) || 0) + 1); });
        return { columns: [{ key: 'name', label: 'Department', fmt: 'str' }, { key: 'n', label: 'People', fmt: 'int', bar: true }], rows: [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) };
      }),
      section('attendance', `Hours worked by person (${ctx.monthLabel})`, 'table', async () => {
        const att = await sr(cfg, 'hr.attendance', [['check_in', '>=', dt(s)], ['check_in', '<=', dtEnd(e)]], ['employee_id', 'worked_hours', 'check_in'], { app: 'Attendances', limit: 20000 });
        const m = new Map(); att.forEach((a) => { const k = nm(a.employee_id) || 'Unknown'; const g = m.get(k) || { name: k, hours: 0, days: new Set() }; g.hours += n0(a.worked_hours); g.days.add(String(a.check_in).slice(0, 10)); m.set(k, g); });
        return { columns: [{ key: 'name', label: 'Employee', fmt: 'str' }, { key: 'hours', label: 'Hours', fmt: 'num1', bar: true }, { key: 'days', label: 'Days present', fmt: 'int' }], rows: [...m.values()].map((g) => ({ name: g.name, hours: g.hours, days: g.days.size })).sort((a, b) => b.hours - a.hours).slice(0, 20), empty: 'No attendance recorded this month.' };
      }),
      section('leave', `Time off (${ctx.monthLabel})`, 'table', async () => {
        const list = await sr(cfg, 'hr.leave', [['state', '=', 'validate'], ['date_from', '<=', dtEnd(e)], ['date_to', '>=', dt(s)]], ['employee_id', 'number_of_days', 'holiday_status_id', 'date_from'], { app: 'Time Off', limit: 2000 });
        return { columns: [{ key: 'name', label: 'Employee', fmt: 'str' }, { key: 'days', label: 'Days', fmt: 'num1', bar: true }, { key: 'type', label: 'Type', fmt: 'str' }, { key: 'from', label: 'From', fmt: 'str' }], rows: list.sort((a, b) => n0(b.number_of_days) - n0(a.number_of_days)).slice(0, 15).map((l) => ({ name: nm(l.employee_id), days: n0(l.number_of_days), type: nm(l.holiday_status_id), from: String(l.date_from).slice(0, 10) })), empty: 'Nobody is on approved leave.' };
      }),
    ];
  }
  return [];
}

async function pool(tasks, size = 3) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

export default route(async (req, res) => {
  allow(req, ['GET']);
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  const cfg = odooConfig();
  if (cfg.missing.length) return res.json({ configured: false, missing: cfg.missing });
  const months = monthsBack(12);
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'inventory';
  const month = months.includes(req.query.month) ? req.query.month : months[months.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  const { s, e } = range(month), pk = prevKey(month), pr = range(pk);
  const ctx = { month, monthLabel: label(month), s, e, ps: pr.s, pe: pr.e, today };

  let info = { version: '', company: '', currency: '' };
  const version = await odooVersion(cfg).catch(() => null);   // unreachable server: let the first real call explain
  info.version = version && version.server_version ? version.server_version : '';
  const company = await call(cfg, 'res.company', 'search_read', [[]], { fields: ['name', 'currency_id'], limit: 1 });
  info.company = company[0] ? company[0].name : '';
  info.currency = company[0] && Array.isArray(company[0].currency_id) ? String(company[0].currency_id[1]).slice(0, 3) : '';
  const sections = await pool(build(tab, cfg, ctx), 3);
  res.json({ configured: true, tab, month, monthLabel: ctx.monthLabel, months: months.map((k) => ({ key: k, label: label(k) })), currency: info.currency, company: info.company, version: info.version, sections });
});
