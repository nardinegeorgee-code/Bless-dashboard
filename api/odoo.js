import { route, allow, requireAdmin } from './_lib.js';
import { odooConfig, odooVersion, call, sr, nm, nid, fieldsOf, needModel } from './_odoo.js';
import { parsePeriod, monthPeriod, dayList } from './_period.js';
import { adSpend, profitTiles } from './_profit.js';

const TZ = process.env.DASHBOARD_TZ || 'Africa/Cairo';

const TABS = ['suppliers', 'raw', 'packaging', 'inventory', 'sales', 'distributors', 'people', 'profit', 'in', 'out', 'hr'];
const pad = (n) => String(n).padStart(2, '0');
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const sum = (rows, f) => rows.reduce((a, r) => a + n0(typeof f === 'function' ? f(r) : r[f]), 0);
const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthsBack = (n) => { const now = new Date(); const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1)); } return out; };
const mkey = (s) => String(s || '').slice(0, 7);
const dt = (d) => d + ' 00:00:00', dtEnd = (d) => d + ' 23:59:59';

const section = (id, title, kind, fn, note) => async () => {
  try { return { id, title, kind, note, ...(await fn()) }; }
  catch (e) { return { id, title, kind, note, error: String(e.message || e).slice(0, 400) }; }
};
/** Product pictures straight from Odoo, as small inline images (256 px), so the browser needs no Odoo login. */
const MIME = [['/9j/', 'image/jpeg'], ['iVBOR', 'image/png'], ['R0lGO', 'image/gif'], ['UklGR', 'image/webp'], ['PHN2', 'image/svg+xml']];
async function addPictures(cfg, list) {
  const ids = [...new Set(list.map((r) => r.pid).filter(Boolean))];
  list.forEach((r) => { if (!ids.length) delete r.pid; });
  if (!ids.length) return list;
  try {
    const have = await fieldsOf(cfg, 'product.product');
    if (have.has('image_256')) {
      const got = await call(cfg, 'product.product', 'read', [ids, ['image_256']], { context: { lang: 'en_US' } });
      const by = new Map();
      for (const g of got) { const b = typeof g.image_256 === 'string' ? g.image_256 : ''; const m = b && b.length < 160000 && MIME.find(([p]) => b.startsWith(p)); if (m) by.set(g.id, `data:${m[1]};base64,${b}`); }
      list.forEach((r) => { if (by.has(r.pid)) r.img = by.get(r.pid); });
    }
  } catch (err) { /* pictures are an extra; the table still works without them */ }
  list.forEach((r) => { delete r.pid; });
  return list;
}
/** Unit cost (the Cost field on the product in Odoo) for a list of product ids. Missing ids simply have no cost. */
async function costsOf(cfg, ids) {
  const out = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  try {
    const got = await call(cfg, 'product.product', 'read', [list, ['standard_price']], { context: { lang: 'en_US' } });
    for (const g of got) if (typeof g.standard_price === 'number') out.set(g.id, g.standard_price);
  } catch (err) { /* the table still works without costs */ }
  return out;
}
const tile = (label, value, fmt, extra = {}) => ({ label, value, fmt, ...extra });
const rows = (r, limit) => r.slice(0, limit);
/** Day-by-day series for a card: this period and the comparison, one value per day. */
const daily = (ctx, cur, prev, dateOf, valOf) => {
  const da = dayList(ctx.s, ctx.e), db = dayList(ctx.ps, ctx.pe);
  const fill = (list, days) => { const m = new Map(days.map((d) => [d, 0])); for (const r of list) { const k = String(dateOf(r) || '').slice(0, 10); if (m.has(k)) m.set(k, m.get(k) + valOf(r)); } return days.map((d) => m.get(d)); };
  return { dates: da, cur: fill(cur, da), cmpDates: db, prev: fill(prev, db) };
};
/**
 * Stock is sorted into raw materials, packaging and finished products by the product category name in Odoo
 * (for example "All / Raw Materials", "All / Packaging"). Words can be changed with ODOO_RAW_WORDS and ODOO_PACKAGING_WORDS.
 */
const wordsRe = (env, dflt) => new RegExp((process.env[env] || dflt).split(',').map((w) => w.trim()).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const KINDS = [['raw', 'Raw materials'], ['pack', 'Packaging'], ['prod', 'Finished products']];
function kindOf(categ) {
  const c = String(categ || '');
  if (wordsRe('ODOO_PACKAGING_WORDS', 'packag,box,carton,bag,label,sticker,wrap,pouch,tape,ribbon,tag').test(c)) return 'pack';
  if (wordsRe('ODOO_RAW_WORDS', 'raw,material,fabric,satin,silk,thread,yarn,elastic,textile,component').test(c)) return 'raw';
  return 'prod';
}
/** What is behind a card: a few totals and the lines that make it up. */
const bd = (summary, columns, list, note) => ({ summary, columns, rows: list.slice(0, 60), more: Math.max(0, list.length - 60), note });
const groupBy = (list, keyOf, init, add) => { const m = new Map(); for (const r of list) { const k = keyOf(r); const g = m.get(k) || { name: k, ...init() }; add(g, r); m.set(k, g); } return [...m.values()]; };
const COL = { name: (l) => ({ key: 'name', label: l, fmt: 'str' }), money: (k, l) => ({ key: k, label: l, fmt: 'money' }), int: (k, l) => ({ key: k, label: l, fmt: 'int' }), pct: (k, l) => ({ key: k, label: l, fmt: 'pct' }), str: (k, l) => ({ key: k, label: l, fmt: 'str' }) };

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
      const totalCost = sum(storable, cost), totalSale = sum(storable, (p) => Math.max(0, n0(p.qty_available)) * n0(p.list_price));
      const kind = (p) => kindOf(nm(p.categ_id));
      const kinds = KINDS.map(([k, name]) => { const list = storable.filter((p) => kind(p) === k); return { k, name, list, value: sum(list, cost), units: sum(list, (p) => Math.max(0, n0(p.qty_available))), cats: [...new Set(list.map((p) => nm(p.categ_id) || 'No category'))] }; });
      const kindTile = (g) => tile(g.name, g.value, 'money', { sub: (totalCost ? pct(g.value, totalCost).toFixed(0) : 0) + '% of stock value · ' + g.list.length + ' products',
        breakdown: bd([{ l: 'Products', v: g.list.length, f: 'int' }, { l: 'Units', v: g.units, f: 'int' }, { l: 'Share of stock value', v: totalCost ? pct(g.value, totalCost) : 0, f: 'pct' }], [COL.name('Product'), COL.str('cat', 'Category'), COL.int('units', 'On hand'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.money('value', 'Stock value')],
          g.list.map((p) => ({ name: p.display_name, cat: nm(p.categ_id) || 'No category', units: Math.max(0, n0(p.qty_available)), unit: n0(p.standard_price), value: cost(p) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value), g.cats.length ? 'Categories counted here: ' + g.cats.slice(0, 12).join(', ') : 'No products in this group.') });
      const byCat = groupBy(storable, (p) => nm(p.categ_id) || 'No category', () => ({ products: 0, units: 0, value: 0 }), (g, p) => { g.products++; g.units += Math.max(0, n0(p.qty_available)); g.value += cost(p); }).sort((a, b) => b.value - a.value).map((g) => ({ ...g, share: totalCost ? pct(g.value, totalCost) : null }));
      const topValue = storable.map((p) => ({ name: p.display_name, units: Math.max(0, n0(p.qty_available)), unit: n0(p.standard_price), value: cost(p), share: totalCost ? pct(cost(p), totalCost) : null })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      const bSale = storable.map((p) => ({ name: p.display_name, units: Math.max(0, n0(p.qty_available)), price: n0(p.list_price), value: Math.max(0, n0(p.qty_available)) * n0(p.list_price), cost: cost(p) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      return { tiles: [
        ...kinds.map(kindTile),
        tile('Stocked products', storable.length, 'int', { breakdown: bd([{ l: 'Categories', v: byCat.length, f: 'int' }, { l: 'Units on hand', v: sum(storable, (p) => Math.max(0, n0(p.qty_available))), f: 'int' }], [COL.name('Category'), COL.int('products', 'Products'), COL.int('units', 'Units'), COL.money('value', 'Stock value'), COL.pct('share', 'Share of value')], byCat) }),
        tile('Stock value (at cost)', totalCost, 'money', { breakdown: bd([{ l: 'Products with value', v: topValue.length, f: 'int' }], [COL.name('Product'), COL.int('units', 'On hand'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.money('value', 'Stock value'), COL.pct('share', 'Share of value')], topValue) }),
        tile('Stock value (at sale price)', totalSale, 'money', { sub: totalSale ? 'potential margin ' + pct(totalSale - totalCost, totalSale).toFixed(0) + '%' : undefined, breakdown: bd([{ l: 'At sale price', v: totalSale, f: 'money' }, { l: 'At cost', v: totalCost, f: 'money' }, { l: 'Potential gross profit', v: totalSale - totalCost, f: 'money' }], [COL.name('Product'), COL.int('units', 'On hand'), { key: 'price', label: 'Sale price', fmt: 'money2' }, COL.money('value', 'Value at sale price'), COL.money('cost', 'Value at cost')], bSale) }),
        tile('Out of stock', out.length, 'int', { goodDown: true, sub: pct(out.length, storable.length).toFixed(0) + '% of stocked products', breakdown: bd([{ l: 'Out of stock', v: out.length, f: 'int' }, { l: 'Share of stocked products', v: pct(out.length, storable.length), f: 'pct' }], [COL.name('Product'), COL.str('code', 'Reference'), COL.int('min', 'Minimum')], out.map((p) => ({ name: p.display_name, code: p.default_code || '–', min: mins.get(p.id) ?? 5 })), 'Products with nothing on hand.') }),
        tile('Running low', low.length, 'int', { goodDown: true, sub: mins.size ? 'at or under the reorder minimum' : 'at 5 units or fewer', breakdown: bd([{ l: 'Running low', v: low.length, f: 'int' }], [COL.name('Product'), COL.int('qty', 'On hand'), COL.int('min', 'Minimum')], low.sort((a, b) => n0(a.qty_available) - n0(b.qty_available)).map((p) => ({ name: p.display_name, qty: n0(p.qty_available), min: mins.get(p.id) ?? 5 }))) }),
        ...(po ? [tile('Purchased in this period', sum(po, 'amount_total'), 'money', { sub: po.length + ' purchase orders' })] : []),
      ] };
    }),
    section('kinds', 'Stock value by type', 'table', async () => {
      const { storable } = await products();
      const cost = (p) => Math.max(0, n0(p.qty_available)) * n0(p.standard_price);
      const rowsK = KINDS.map(([k, name]) => { const list = storable.filter((p) => kindOf(nm(p.categ_id)) === k); const cats = groupBy(list, (p) => nm(p.categ_id) || 'No category', () => ({ v: 0 }), (g, p) => { g.v += cost(p); }).sort((a, b) => b.v - a.v).slice(0, 4).map((g) => g.name.replace(/^All\s*\/\s*/i, ''));
        return { name, value: sum(list, cost), products: list.length, units: sum(list, (p) => Math.max(0, n0(p.qty_available))), cats: cats.join(', ') || '–' }; });
      return { columns: [{ key: 'name', label: 'Type', fmt: 'str' }, { key: 'value', label: 'Stock value (at cost)', fmt: 'money', bar: true }, { key: 'products', label: 'Products', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'cats', label: 'Main categories', fmt: 'str' }], rows: rowsK };
    }, 'Sorted by the product category name in Odoo. If a product lands in the wrong group, rename its category (for example "Raw Materials" or "Packaging") or set ODOO_RAW_WORDS / ODOO_PACKAGING_WORDS in Vercel.'),
    section('attention', 'Needs restocking', 'table', async () => {
      const { storable, mins } = await products();
      const list = storable.filter((p) => n0(p.qty_available) <= (mins.get(p.id) ?? 5))
        .sort((a, b) => n0(a.qty_available) - n0(b.qty_available)).slice(0, 15)
        .map((p) => ({ pid: p.id, name: p.display_name, qty: n0(p.qty_available), incoming: Math.max(0, n0(p.virtual_available) - n0(p.qty_available)), min: mins.get(p.id) ?? 5, cost: n0(p.standard_price) }));
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'qty', label: 'On hand', fmt: 'int', bar: true, barReverse: true }, { key: 'incoming', label: 'Arriving', fmt: 'int' }, { key: 'min', label: 'Minimum', fmt: 'int' }, { key: 'cost', label: 'Unit cost', fmt: 'money2' }], rows: await addPictures(cfg, list), empty: 'Nothing is running low.' };
    }, 'Products at or under their reorder minimum (5 units when no minimum is set in Odoo).'),
    section('value', 'Where your money is sitting in stock', 'table', async () => {
      const { storable } = await products();
      const list = storable.map((p) => ({ pid: p.id, name: p.display_name, value: Math.max(0, n0(p.qty_available)) * n0(p.standard_price), qty: n0(p.qty_available), cost: n0(p.standard_price) }))
        .filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 15);
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'value', label: 'Stock value', fmt: 'money', bar: true }, { key: 'qty', label: 'On hand', fmt: 'int' }, { key: 'cost', label: 'Unit cost', fmt: 'money' }], rows: await addPictures(cfg, list), empty: 'No stock value yet. Set a cost on your products in Odoo.' };
    }),
    section('cat', 'Stock by category', 'table', async () => {
      const { storable } = await products();
      const m = new Map();
      for (const p of storable) { const k = nm(p.categ_id) || 'No category'; const g = m.get(k) || { name: k, value: 0, products: 0, units: 0 }; g.value += Math.max(0, n0(p.qty_available)) * n0(p.standard_price); g.products++; g.units += Math.max(0, n0(p.qty_available)); m.set(k, g); }
      return { columns: [{ key: 'name', label: 'Category', fmt: 'str' }, { key: 'value', label: 'Stock value', fmt: 'money', bar: true }, { key: 'products', label: 'Products', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 15) };
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

  /* ---------- Supply: suppliers, raw materials, packaging ---------- */
  const poOrders = (a, b) => sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']], ['date_order', '>=', dt(a)], ['date_order', '<=', dtEnd(b)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Purchase', limit: 20000 });
  const openPOs = () => once('openPOs', async () => {
    const f = await needModel(cfg, 'purchase.order', 'Purchase');
    const list = await sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']]], ['name', 'partner_id', 'amount_total', 'date_planned', 'receipt_status'], { app: 'Purchase', order: 'date_planned asc', limit: 2000 });
    return list.filter((o) => (f.has('receipt_status') ? o.receipt_status !== 'full' : true))
      .map((o) => ({ name: o.name, supplier: nm(o.partner_id) || 'Unknown', amount: n0(o.amount_total), due: String(o.date_planned || '').slice(0, 10), status: o.receipt_status ? String(o.receipt_status).replace(/_/g, ' ') : '–' }));
  });
  // Every purchase line (product, supplier, quantity, price) from the earliest date any card needs.
  const supplyFrom = [ps, s, monthsBack(12)[0] + '-01'].sort()[0];
  const poLines = () => once('poLines', async () => {
    const [lines, orders] = await Promise.all([
      sr(cfg, 'purchase.order.line', [['order_id.state', 'in', ['purchase', 'done']], ['order_id.date_order', '>=', dt(supplyFrom)]], ['order_id', 'product_id', 'product_qty', 'price_unit', 'price_subtotal'], { app: 'Purchase', limit: 40000 }),
      sr(cfg, 'purchase.order', [['state', 'in', ['purchase', 'done']], ['date_order', '>=', dt(supplyFrom)]], ['name', 'partner_id', 'date_order'], { app: 'Purchase', limit: 40000 }),
    ]);
    const o = new Map(orders.map((x) => [x.id, x]));
    return lines.map((l) => { const x = o.get(nid(l.order_id)) || {}; return { pid: nid(l.product_id), product: nm(l.product_id) || 'Other', order: x.name || nm(l.order_id) || '–', supplier: nm(x.partner_id) || 'Unknown', date: String(x.date_order || '').slice(0, 10), qty: n0(l.product_qty), price: n0(l.price_unit), total: n0(l.price_subtotal) }; });
  });
  const buyCols = [COL.name('Order'), COL.str('supplier', 'Supplier'), COL.str('date', 'Date'), COL.int('qty', 'Qty'), { key: 'price', label: 'Unit price', fmt: 'money2' }, COL.money('total', 'Total')];
  const owedRows = (list) => list.map((m) => ({ name: m.name, who: nm(m.partner_id) || 'Unknown', due: m.invoice_date_due || '–', owed: resid(m) })).sort((a, b) => b.owed - a.owed);

  if (tab === 'suppliers') return [
    section('kpi', `Suppliers (${ctx.monthLabel})`, 'kpi', async () => {
      const [cur, prev, bills, open] = await Promise.all([poOrders(s, e), poOrders(ps, pe), invoices(['in_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]), openPOs()]);
      const bySup = (list) => groupBy(list, (o) => nm(o.partner_id) || 'Unknown', () => ({ count: 0, amount: 0 }), (g, o) => { g.count++; g.amount += n0(o.amount_total); }).sort((a, b) => b.amount - a.amount);
      const total = sum(cur, 'amount_total'), sup = bySup(cur), supRows = sup.map((g) => ({ ...g, share: pct(g.amount, total) }));
      const supCols = [COL.name('Supplier'), COL.int('count', 'Orders'), COL.money('amount', 'Purchased'), COL.pct('share', 'Share')];
      const orderRows = cur.map((o) => ({ name: o.name, who: nm(o.partner_id) || 'Unknown', date: String(o.date_order).slice(0, 10), amount: n0(o.amount_total) })).sort((a, b) => b.date.localeCompare(a.date));
      const late = open.filter((o) => o.due && o.due < today);
      const openCols = [COL.name('Order'), COL.str('supplier', 'Supplier'), COL.str('due', 'Expected'), COL.money('amount', 'Value'), COL.str('status', 'Status')];
      const dP = daily(ctx, cur, prev, (o) => o.date_order, (o) => n0(o.amount_total));
      return { tiles: [
        tile('Purchased', total, 'money', { prev: sum(prev, 'amount_total'), daily: dP, breakdown: bd([{ l: 'Orders', v: cur.length, f: 'int' }, { l: 'Suppliers', v: sup.length, f: 'int' }], supCols, supRows) }),
        tile('Purchase orders', cur.length, 'int', { prev: prev.length, breakdown: bd([{ l: 'Orders', v: cur.length, f: 'int' }], [COL.name('Order'), COL.str('who', 'Supplier'), COL.str('date', 'Date'), COL.money('amount', 'Value')], orderRows) }),
        tile('Active suppliers', sup.length, 'int', { prev: bySup(prev).length, breakdown: bd([{ l: 'Suppliers', v: sup.length, f: 'int' }], supCols, supRows) }),
        tile('Average order', cur.length ? total / cur.length : 0, 'money', { prev: prev.length ? sum(prev, 'amount_total') / prev.length : undefined }),
        tile('You owe suppliers', sum(bills, resid), 'money', { goodDown: true, sub: bills.length + ' open bills', breakdown: bd([{ l: 'Open bills', v: bills.length, f: 'int' }], [COL.name('Bill'), COL.str('who', 'Supplier'), COL.str('due', 'Due'), COL.money('owed', 'Still to pay')], owedRows(bills)) }),
        tile('Waiting to arrive', open.length, 'int', { sub: 'purchase orders not fully received', breakdown: bd([{ l: 'Value', v: sum(open, 'amount'), f: 'money' }], openCols, open) }),
        tile('Late deliveries', late.length, 'int', { goodDown: true, sub: 'expected date has passed', breakdown: bd([{ l: 'Late orders', v: late.length, f: 'int' }], openCols, late) }),
      ] };
    }, 'Purchase orders confirmed in Odoo. Click a card to see what is behind it.'),
    section('top', `Suppliers ranked (${ctx.monthLabel})`, 'table', async () => {
      const L = (await poLines()).filter((l) => l.date >= s && l.date <= e);
      const bills = await invoices(['in_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]);
      const owed = new Map(); bills.forEach((m) => owed.set(nm(m.partner_id) || 'Unknown', (owed.get(nm(m.partner_id) || 'Unknown') || 0) + resid(m)));
      const total = sum(L, 'total');
      const rowsOut = groupBy(L, (l) => l.supplier, () => ({ value: 0, orders: new Set(), items: new Map(), buys: [] }), (g, l) => { g.value += l.total; g.orders.add(l.order); g.buys.push(l); const it = g.items.get(l.product) || { name: l.product, qty: 0, total: 0 }; it.qty += l.qty; it.total += l.total; g.items.set(l.product, it); })
        .sort((a, b) => b.value - a.value).map((g) => ({ name: g.name, value: g.value, share: pct(g.value, total), orders: g.orders.size, products: g.items.size, owed: owed.get(g.name) || 0,
          breakdown: { plain: true, summary: [{ l: 'Purchased', v: g.value, f: 'money' }, { l: 'Orders', v: g.orders.size, f: 'int' }, { l: 'Products', v: g.items.size, f: 'int' }, { l: 'You still owe', v: owed.get(g.name) || 0, f: 'money' }],
            columns: [COL.name('Product'), COL.int('qty', 'Qty'), { key: 'avg', label: 'Average price', fmt: 'money2' }, COL.money('total', 'Total')],
            rows: [...g.items.values()].map((i) => ({ ...i, avg: i.qty ? i.total / i.qty : 0 })).sort((a, b) => b.total - a.total).slice(0, 100),
            extra: [{ title: 'Orders', columns: buyCols, rows: g.buys.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100) }] } }));
      return { initial: 10, columns: [COL.name('Supplier'), { key: 'value', label: 'Purchased', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('orders', 'Orders'), COL.int('products', 'Products'), COL.money('owed', 'You still owe')], rows: rowsOut.map((r) => ({ ...r, only: true })), empty: 'No purchase orders in this period.' };
    }, 'Click a supplier to see what you buy from them, at what price, and each order.'),
    section('po', 'Purchase orders still to receive', 'table', async () => {
      const open = (await openPOs()).slice(0, 25);
      return { columns: [COL.name('Order'), { key: 'amount', label: 'Value', fmt: 'money', bar: true }, COL.str('due', 'Expected'), COL.str('status', 'Status')], rows: open.map((o) => ({ ...o, name: `${o.name} · ${o.supplier}` })), empty: 'Nothing waiting to arrive.' };
    }),
  ];

  const stockKind = (kind, noun) => {
    const inKind = (p) => kindOf(nm(p.categ_id)) === kind;
    const cost = (p) => Math.max(0, n0(p.qty_available)) * n0(p.standard_price);
    const mine = () => once('mine' + kind, async () => { const { storable, mins } = await products(); const list = storable.filter(inKind); return { list, mins, ids: new Set(list.map((p) => p.id)) }; });
    const bought = () => once('bought' + kind, async () => { const { ids } = await mine(); return (await poLines()).filter((l) => ids.has(l.pid)); });
    const inP = (l, a, b) => l.date >= a && l.date <= b;
    const lastBuy = (L, pid) => L.filter((l) => l.pid === pid).sort((a, b) => b.date.localeCompare(a.date))[0];
    const stockRows = (arr) => arr.map((p) => ({ name: p.display_name, units: Math.max(0, n0(p.qty_available)), unit: n0(p.standard_price), value: cost(p) })).sort((a, b) => b.value - a.value);
    const stockCols = [COL.name('Product'), COL.int('units', 'On hand'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.money('value', 'Value')];
    return [
      section('kpi', `${noun} at a glance`, 'kpi', async () => {
        const { list, mins } = await mine(), L = await bought();
        const cur = L.filter((l) => inP(l, s, e)), prev = L.filter((l) => inP(l, ps, pe));
        const out = list.filter((p) => n0(p.qty_available) <= 0), low = list.filter((p) => n0(p.qty_available) > 0 && n0(p.qty_available) <= (mins.get(p.id) ?? 5));
        const sup = groupBy(cur, (l) => l.supplier, () => ({ count: 0, amount: 0 }), (g, l) => { g.count++; g.amount += l.total; }).sort((a, b) => b.amount - a.amount);
        const total = sum(list, cost);
        return { tiles: [
          tile(`${noun} stock value`, total, 'money', { sub: list.length + ' products', breakdown: bd([{ l: 'Products', v: list.length, f: 'int' }, { l: 'Units', v: sum(list, (p) => Math.max(0, n0(p.qty_available))), f: 'int' }], stockCols, stockRows(list).filter((x) => x.value > 0)) }),
          tile('Products', list.length, 'int', { breakdown: bd([{ l: 'Products', v: list.length, f: 'int' }], stockCols, stockRows(list)) }),
          tile('Out of stock', out.length, 'int', { goodDown: true, breakdown: bd([{ l: 'Out of stock', v: out.length, f: 'int' }], stockCols, stockRows(out)) }),
          tile('Running low', low.length, 'int', { goodDown: true, sub: mins.size ? 'at or under the reorder minimum' : 'at 5 units or fewer', breakdown: bd([{ l: 'Running low', v: low.length, f: 'int' }], stockCols, stockRows(low)) }),
          tile('Bought in this period', sum(cur, 'total'), 'money', { prev: sum(prev, 'total'), daily: daily(ctx, cur, prev, (l) => l.date, (l) => l.total), breakdown: bd([{ l: 'Purchase lines', v: cur.length, f: 'int' }, { l: 'Suppliers', v: sup.length, f: 'int' }], [COL.name('Supplier'), COL.int('count', 'Lines'), COL.money('amount', 'Spent')], sup) }),
          tile('Suppliers used', sup.length, 'int', { breakdown: bd([{ l: 'Suppliers', v: sup.length, f: 'int' }], [COL.name('Supplier'), COL.int('count', 'Lines'), COL.money('amount', 'Spent')], sup) }),
        ] };
      }, `Sorted by the Odoo product category name. If a product is in the wrong group, rename its category or set ODOO_RAW_WORDS / ODOO_PACKAGING_WORDS in Vercel.`),
      section('trend', 'Last 12 months of buying', 'trend', async () => {
        const t = await trend12([['spend', async () => (await bought()).map((l) => ({ ...l, _d: l.date })), 'total'], ['qty', async () => (await bought()).map((l) => ({ ...l, _d: l.date })), 'qty']]);
        return { ...t, metrics: [{ key: 'spend', label: 'Spent', fmt: 'money' }, { key: 'qty', label: 'Units bought', fmt: 'int' }], monthBars: { keys: ['spend'], base: 'spend' } };
      }),
      section('stock', `${noun} in stock`, 'table', async () => {
        const { list, mins } = await mine(), L = await bought();
        const rowsOut = list.map((p) => { const buys = L.filter((l) => l.pid === p.id).sort((a, b) => b.date.localeCompare(a.date)), last = buys[0], qty = sum(buys, 'qty'), spent = sum(buys, 'total'), min = mins.get(p.id) ?? 5;
          return { pid: p.id, name: p.display_name, value: cost(p), units: Math.max(0, n0(p.qty_available)), unit: n0(p.standard_price), min, status: n0(p.qty_available) <= 0 ? 'Out of stock' : n0(p.qty_available) <= min ? 'Running low' : 'OK', supplier: last ? last.supplier : '–',
            breakdown: { summary: [{ l: 'Bought (12 months)', v: qty, f: 'int' }, { l: 'Spent', v: spent, f: 'money' }, { l: 'Average price', v: qty ? spent / qty : 0, f: 'money' }, { l: 'Last price', v: last ? last.price : 0, f: 'money' }], columns: buyCols, rows: buys.slice(0, 60), more: Math.max(0, buys.length - 60), note: buys.length ? undefined : 'No purchase orders for this product in the last 12 months.' } }; }).sort((a, b) => b.value - a.value);
        return { initial: 15, columns: [COL.name('Product'), { key: 'value', label: 'Stock value', fmt: 'money', bar: true }, COL.int('units', 'On hand'), { key: 'unit', label: 'Unit cost', fmt: 'money2' }, COL.int('min', 'Minimum'), COL.str('status', 'Status'), COL.str('supplier', 'Last supplier')], rows: await addPictures(cfg, rowsOut.slice(0, 200)), empty: `No ${noun.toLowerCase()} found. Check the product categories in Odoo.` };
      }, 'Click a product to see every time you bought it, from whom and at what price.'),
      section('buying', `What you bought (${ctx.monthLabel})`, 'table', async () => {
        const L = await bought(), cur = L.filter((l) => inP(l, s, e));
        const before = (pid, d) => L.filter((l) => l.pid === pid && l.date < d);
        const rowsOut = groupBy(cur, (l) => l.product, () => ({ pid: 0, qty: 0, spent: 0, sup: new Set(), buys: [] }), (g, l) => { g.pid = l.pid; g.qty += l.qty; g.spent += l.total; g.sup.add(l.supplier); g.buys.push(l); })
          .sort((a, b) => b.spent - a.spent).map((g) => { const avg = g.qty ? g.spent / g.qty : 0, old = before(g.pid, s), oq = sum(old, 'qty'), oavg = oq ? sum(old, 'total') / oq : null;
            return { name: g.name, spent: g.spent, qty: g.qty, avg, change: oavg ? ((avg - oavg) / oavg) * 100 : null, suppliers: g.sup.size, breakdown: { summary: [{ l: 'Spent', v: g.spent, f: 'money' }, { l: 'Units', v: g.qty, f: 'int' }, { l: 'Suppliers', v: g.sup.size, f: 'int' }], columns: buyCols, rows: g.buys.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60) } }; });
        return { initial: 15, columns: [COL.name('Product'), { key: 'spent', label: 'Spent', fmt: 'money', bar: true }, COL.int('qty', 'Units'), { key: 'avg', label: 'Average price', fmt: 'money2' }, COL.pct('change', 'Price vs before'), COL.int('suppliers', 'Suppliers')], rows: rowsOut, empty: 'Nothing was bought in this period.' };
      }, 'Price vs before compares this period\'s average price with everything bought earlier.'),
      section('who', `Who you buy from (${ctx.monthLabel})`, 'table', async () => {
        const cur = (await bought()).filter((l) => inP(l, s, e)), total = sum(cur, 'total');
        const rowsOut = groupBy(cur, (l) => l.supplier, () => ({ spent: 0, items: new Map(), orders: new Set() }), (g, l) => { g.spent += l.total; g.orders.add(l.order); const it = g.items.get(l.product) || { name: l.product, qty: 0, total: 0 }; it.qty += l.qty; it.total += l.total; g.items.set(l.product, it); })
          .sort((a, b) => b.spent - a.spent).map((g) => ({ name: g.name, spent: g.spent, share: pct(g.spent, total), orders: g.orders.size, breakdown: { summary: [{ l: 'Spent', v: g.spent, f: 'money' }, { l: 'Orders', v: g.orders.size, f: 'int' }], columns: [COL.name('Product'), COL.int('qty', 'Qty'), { key: 'avg', label: 'Average price', fmt: 'money2' }, COL.money('total', 'Total')], rows: [...g.items.values()].map((i) => ({ ...i, avg: i.qty ? i.total / i.qty : 0 })).sort((a, b) => b.total - a.total).slice(0, 60) } }));
        return { initial: 10, columns: [COL.name('Supplier'), { key: 'spent', label: 'Spent', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('orders', 'Orders')], rows: rowsOut, empty: 'Nothing was bought in this period.' };
      }),
    ];
  };
  if (tab === 'raw') return stockKind('raw', 'Raw materials');
  if (tab === 'packaging') return stockKind('pack', 'Packaging');

  /* ---------- Sales: distributors and salespeople ---------- */
  if (tab === 'distributors') return [
    section('kpi', `Distributors (${ctx.monthLabel})`, 'kpi', async () => {
      const so = (a, b) => sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(a)], ['date_order', '<=', dtEnd(b)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Sales', limit: 20000 });
      const [cur, prev, older, recv] = await Promise.all([so(s, e), so(ps, pe), sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '<', dt(s)]], ['partner_id'], { app: 'Sales', limit: 50000 }), invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]])]);
      const ids = [...new Set([...cur, ...prev, ...older, ...recv].map((x) => nid(x.partner_id)).filter(Boolean))], top = new Map();
      for (let i = 0; i < ids.length; i += 500) { try { for (const g of await call(cfg, 'res.partner', 'read', [ids.slice(i, i + 500), ['commercial_partner_id']])) top.set(g.id, nm(g.commercial_partner_id)); } catch (err) { break; } }
      const who = (x) => top.get(nid(x.partner_id)) || nm(x.partner_id) || 'Unknown';
      const by = (list) => groupBy(list, who, () => ({ orders: 0, value: 0 }), (g, o) => { g.orders++; g.value += n0(o.amount_total); }).sort((a, b) => b.value - a.value);
      const dist = by(cur), pdist = by(prev), total = sum(cur, 'amount_total'), had = new Set(older.map(who));
      const fresh = dist.filter((g) => !had.has(g.name));
      const dCols = [COL.name('Distributor'), COL.int('orders', 'Orders'), COL.money('value', 'Order value'), COL.pct('share', 'Share')];
      const dRows = (arr) => arr.map((g) => ({ ...g, share: pct(g.value, total) }));
      const owedBy = groupBy(recv, who, () => ({ count: 0, owed: 0, late: 0 }), (g, m) => { g.count++; g.owed += resid(m); if (m.invoice_date_due && m.invoice_date_due < today) g.late += resid(m); }).sort((a, b) => b.owed - a.owed);
      const owedCols = [COL.name('Distributor'), COL.int('count', 'Open invoices'), COL.money('owed', 'Still owed'), COL.money('late', 'Of which late')];
      return { tiles: [
        tile('Active distributors', dist.length, 'int', { prev: pdist.length, sub: 'ordered in this period', breakdown: bd([{ l: 'Distributors', v: dist.length, f: 'int' }, { l: 'Order value', v: total, f: 'money' }], dCols, dRows(dist)) }),
        tile('New distributors', fresh.length, 'int', { sub: 'first order ever in this period', breakdown: bd([{ l: 'New', v: fresh.length, f: 'int' }], dCols, dRows(fresh)) }),
        tile('Average per distributor', dist.length ? total / dist.length : 0, 'money', { prev: pdist.length ? sum(prev, 'amount_total') / pdist.length : undefined, breakdown: bd([{ l: 'Distributors', v: dist.length, f: 'int' }], dCols, dRows(dist)) }),
        tile('Orders per distributor', dist.length ? cur.length / dist.length : 0, 'num1', { prev: pdist.length ? prev.length / pdist.length : undefined }),
        tile('Distributors owe you', sum(recv, resid), 'money', { goodDown: true, sub: owedBy.length + ' distributors', breakdown: bd([{ l: 'Open invoices', v: recv.length, f: 'int' }], owedCols, owedBy) }),
        tile('Top distributor share', dist.length && total ? pct(dist[0].value, total) : 0, 'pct', { goodDown: true, sub: dist.length ? dist[0].name : undefined, breakdown: bd([{ l: 'Top 3 share', v: pct(sum(dist.slice(0, 3), 'value'), total), f: 'pct' }], dCols, dRows(dist.slice(0, 10))) }),
      ] };
    }, 'A distributor is a customer with a confirmed order. Contacts of one company are counted together.'),
    section('customers', `Top customers (${ctx.monthLabel})`, 'table', async () => {
      const [list, inv] = await Promise.all([
        sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(s)], ['date_order', '<=', dtEnd(e)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Sales', limit: 20000 }),
        sr(cfg, 'account.move', [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'], ['invoice_date', '>=', s], ['invoice_date', '<=', e]], ['name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due', 'amount_total_signed', 'amount_residual', 'payment_state'], { app: 'Accounting', limit: 20000 }),
      ]);
      // Contacts of a company are counted under the company, so orders and invoices of the same customer meet.
      const ids = [...new Set([...list, ...inv].map((x) => nid(x.partner_id)).filter(Boolean))], top = new Map();
      for (let i = 0; i < ids.length; i += 500) { try { for (const g of await call(cfg, 'res.partner', 'read', [ids.slice(i, i + 500), ['commercial_partner_id']])) top.set(g.id, nm(g.commercial_partner_id)); } catch (err) { break; } }
      const who = (x) => top.get(nid(x.partner_id)) || nm(x.partner_id) || 'Unknown';
      const m = new Map();
      const get = (k) => { if (!m.has(k)) m.set(k, { name: k, value: 0, orders: 0, invoices: 0, invoiced: 0, orderRows: [], invRows: [] }); return m.get(k); };
      for (const o of list) { const g = get(who(o)); g.value += n0(o.amount_total); g.orders++; g.orderRows.push({ name: o.name, date: String(o.date_order).slice(0, 10), amount: n0(o.amount_total) }); }
      const pay = { paid: 'Paid', not_paid: 'Not paid', partial: 'Partly paid', in_payment: 'In payment', reversed: 'Reversed' };
      for (const x of inv) { const g = get(who(x)); const v = amt(x); g.invoices++; g.invoiced += v; g.invRows.push({ name: x.name, date: x.invoice_date, amount: v, owed: resid(x), status: pay[x.payment_state] || String(x.payment_state || '–').replace(/_/g, ' ') }); }
      const rowsOut = [...m.values()].filter((g) => g.orders).sort((a, b) => b.value - a.value).slice(0, 300).map((g) => ({ name: g.name, value: g.value, orders: g.orders, invoices: g.invoices, invoiced: g.invoiced,
        breakdown: { plain: true, summary: [{ l: 'Orders', v: g.orders, f: 'int' }, { l: 'Order value', v: g.value, f: 'money' }, { l: 'Invoices', v: g.invoices, f: 'int' }, { l: 'Invoiced', v: g.invoiced, f: 'money' }],
          columns: [{ key: 'name', label: 'Invoice', fmt: 'str' }, { key: 'date', label: 'Date', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }, { key: 'owed', label: 'Still owed', fmt: 'money' }, { key: 'status', label: 'Payment', fmt: 'str' }],
          rows: g.invRows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 100), more: Math.max(0, g.invRows.length - 100), note: g.invRows.length ? undefined : 'No invoices were issued to this customer in this period.',
          extra: [{ title: 'Orders', columns: [{ key: 'name', label: 'Order', fmt: 'str' }, { key: 'date', label: 'Date', fmt: 'str' }, { key: 'amount', label: 'Value', fmt: 'money' }], rows: g.orderRows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100) }] } }));
      return { initial: 10, columns: [{ key: 'name', label: 'Customer', fmt: 'str' }, { key: 'value', label: 'Order value', fmt: 'money', bar: true }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'invoices', label: 'Invoices', fmt: 'int' }, { key: 'invoiced', label: 'Invoiced', fmt: 'money' }], rows: rowsOut.map((r) => ({ ...r, only: true })), empty: 'No confirmed orders in this period.' };
    }, 'Click a customer to see each invoice and order. Orders and invoices of a company\'s contacts are counted together.'),
    section('cities', `Sales by city (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(s)], ['date_order', '<=', dtEnd(e)]], ['name', 'partner_id', 'partner_shipping_id', 'amount_total'], { app: 'Sales', limit: 20000 });
      const addr = (o) => nid(o.partner_shipping_id) || nid(o.partner_id), pids = [...new Set(list.map(addr).filter(Boolean))], city = new Map();
      for (let i = 0; i < pids.length; i += 500) { try { for (const g of await call(cfg, 'res.partner', 'read', [pids.slice(i, i + 500), ['city', 'state_id']])) city.set(g.id, (g.city || '').trim() || nm(g.state_id) || 'Unknown'); } catch (err) { break; } }
      const total = sum(list, 'amount_total');
      const rowsOut = groupBy(list, (o) => city.get(addr(o)) || 'Unknown', () => ({ value: 0, orders: 0, d: new Map() }), (g, o) => { g.value += n0(o.amount_total); g.orders++; const k = nm(o.partner_id) || 'Unknown'; const x = g.d.get(k) || { name: k, orders: 0, value: 0 }; x.orders++; x.value += n0(o.amount_total); g.d.set(k, x); })
        .sort((a, b) => b.value - a.value).map((g) => ({ name: g.name, value: g.value, share: pct(g.value, total), orders: g.orders, distributors: g.d.size, breakdown: { summary: [{ l: 'Order value', v: g.value, f: 'money' }, { l: 'Orders', v: g.orders, f: 'int' }, { l: 'Distributors', v: g.d.size, f: 'int' }], columns: [COL.name('Distributor'), COL.int('orders', 'Orders'), COL.money('value', 'Order value')], rows: [...g.d.values()].sort((a, b) => b.value - a.value).slice(0, 100) } }));
      return { initial: 10, columns: [COL.name('City'), { key: 'value', label: 'Order value', fmt: 'money', bar: true }, COL.pct('share', 'Share'), COL.int('orders', 'Orders'), COL.int('distributors', 'Distributors')], rows: rowsOut, empty: 'No confirmed orders in this period.' };
    }, 'City comes from the delivery address on the order.'),
  ];
  if (tab === 'people') return [
      section('reps', 'Sales by salesperson', 'reps', async () => {
        const m12 = monthsBack(12), start = [ps, s, m12[0] + '-01'].sort()[0];
        // Which field holds the salesperson? Odoo's own "Salesperson" is user_id, but shops often add their own, so look at every
        // "who sold it" field on the order and use the ones that are actually filled in.
        let metaF = {}; try { metaF = await call(cfg, 'sale.order', 'fields_get', [], { attributes: ['string', 'type', 'relation'] }); } catch (err) { /* user_id below */ }
        const repFields = Object.entries(metaF).filter(([k, f]) => ['many2one', 'char', 'selection'].includes(f.type) && f.relation !== 'crm.team' && (k === 'user_id' || /sales\s*-?\s*(person|rep|man|agent)/i.test(String(f.string)))).map(([k]) => k);
        if (!repFields.length) repFields.push('user_id');
        const [orders, lines, invs] = await Promise.all([
          sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['name', 'partner_id', 'partner_shipping_id', ...repFields, 'amount_untaxed', 'date_order'], { app: 'Sales', limit: 30000 }).catch(() => sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['name', 'partner_id', ...repFields, 'amount_untaxed', 'date_order'], { app: 'Sales', limit: 30000 })),
          sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(start)]], ['order_id', 'product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 60000 }),
          sr(cfg, 'account.move', [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'], ['invoice_date', '>=', start]], ['name', 'partner_id', 'invoice_user_id', 'invoice_origin', 'move_type', 'invoice_date', 'amount_untaxed_signed', 'payment_state'], { app: 'Accounting', limit: 30000 }),
        ]);
        const addr = (o) => nid(o.partner_shipping_id) || nid(o.partner_id), pids = [...new Set(orders.flatMap((o) => [addr(o), nid(o.partner_id)]).filter(Boolean))], city = new Map();
        for (let i = 0; i < pids.length; i += 500) {
          try { for (const g of await call(cfg, 'res.partner', 'read', [pids.slice(i, i + 500), ['city', 'state_id']])) city.set(g.id, (g.city || '').trim() || nm(g.state_id) || 'Unknown'); } catch (err) { break; }
        }
        // A shared login such as "Sales indoor" can hide several people, so a field that names the actual person (Sales Representative) wins over Odoo's Salesperson login.
        const val = (o, f) => { const v = o[f]; return Array.isArray(v) ? nm(v) : typeof v === 'string' ? v.trim() : ''; };
        const filled = Object.fromEntries(repFields.map((f) => [f, orders.filter((o) => val(o, f)).length])), order = [...repFields].sort((a, b) => (a === 'user_id') - (b === 'user_id') || filled[b] - filled[a]);
        const who = (o) => { for (const f of order) if (val(o, f)) return val(o, f); return 'No salesperson'; }, inR = (d, a, b) => d >= a && d <= b;
        const byName = new Map(orders.map((o) => [o.name, who(o)])), info = new Map(orders.map((o) => [o.id, { rep: who(o), day: String(o.date_order).slice(0, 10), customer: nm(o.partner_id) || 'Unknown', city: city.get(addr(o)) || city.get(nid(o.partner_id)) || 'Unknown' }]));
        const reps = new Map(); const R = (name) => { if (!reps.has(name)) reps.set(name, { name, cur: { sales: 0, orders: 0, units: 0, invoiced: 0, invoices: 0 }, prev: { sales: 0, orders: 0, units: 0, invoiced: 0, invoices: 0 }, months: new Map(m12.map((k) => [k, { key: k, label: label(k), sales: 0, orders: 0, units: 0, invoiced: 0 }])), cities: new Map(), customers: new Map(), prods: new Map(), prodDist: new Map(), custCity: new Map(), custProd: new Map(), cityDist: new Map(), invoiceList: [] }); return reps.get(name); };
        const nest = (m, a, b, init) => { if (!m.has(a)) m.set(a, new Map()); const x = m.get(a); if (!x.has(b)) x.set(b, init()); return x.get(b); };
        const bump = (map, key, f) => { const g = map.get(key) || { name: key, orders: 0, units: 0, sales: 0, ids: new Set() }; f(g); map.set(key, g); };
        for (const o of orders) {
          const i = info.get(o.id), r = R(i.rep), v = n0(o.amount_untaxed), k = i.day.slice(0, 7), mo = r.months.get(k);
          if (mo) { mo.sales += v; mo.orders++; }
          const w = inR(i.day, s, e) ? r.cur : inR(i.day, ps, pe) ? r.prev : null;
          if (w) { w.sales += v; w.orders++; }
          if (w === r.cur) { for (const [map, key] of [[r.cities, i.city], [r.customers, i.customer]]) bump(map, key, (g) => { g.orders++; g.sales += v; }); nest(r.custCity, i.customer, i.city, () => ({ n: 0 })).n++; }
        }
        for (const l of lines) {
          const i = info.get(nid(l.order_id)); if (!i) continue; const r = R(i.rep), q = n0(l.product_uom_qty), v = n0(l.price_subtotal), mo = r.months.get(i.day.slice(0, 7));
          if (mo) mo.units += q;
          const w = inR(i.day, s, e) ? r.cur : inR(i.day, ps, pe) ? r.prev : null;
          if (w) w.units += q;
          if (w === r.cur) { bump(r.cities, i.city, (g) => { g.units += q; }); bump(r.customers, i.customer, (g) => { g.units += q; }); const pn = nm(l.product_id) || 'Other', oid = nid(l.order_id);
            bump(r.prods, pn, (g) => { g.units += q; g.sales += v; g.ids.add(oid); });
            const a = nest(r.prodDist, pn, i.customer, () => ({ ids: new Set(), units: 0, sales: 0 })); a.ids.add(oid); a.units += q; a.sales += v;
            const b = nest(r.custProd, i.customer, pn, () => ({ units: 0, sales: 0 })); b.units += q; b.sales += v;
            const c2 = nest(r.cityDist, i.city, i.customer, () => ({ ids: new Set(), units: 0, sales: 0 })); c2.ids.add(oid); c2.units += q; c2.sales += v; }
        }
        for (const m of invs) {
          const fromOrder = String(m.invoice_origin || '').split(/[,\s]+/).map((x) => byName.get(x)).find(Boolean), r = R(fromOrder || nm(m.invoice_user_id) || 'No salesperson'), d = String(m.invoice_date), v = (m.move_type === 'out_refund' ? -1 : 1) * Math.abs(n0(m.amount_untaxed_signed)), mo = r.months.get(d.slice(0, 7));
          if (mo) mo.invoiced += v;
          const w = inR(d, s, e) ? r.cur : inR(d, ps, pe) ? r.prev : null;
          if (w) { w.invoiced += v; w.invoices++; }
          if (w === r.cur) r.invoiceList.push({ name: m.name, customer: nm(m.partner_id) || 'Unknown', date: d, amount: v, status: String(m.payment_state || '').replace(/_/g, ' ') || '–' });
        }
        const list = (map) => [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, 40).map((g) => ({ name: g.name, sales: g.sales, orders: g.ids && g.ids.size ? g.ids.size : g.orders, units: g.units }));
        const distRows = (m) => [...(m || new Map()).entries()].map(([name, g]) => ({ name, orders: g.ids.size, units: g.units, sales: g.sales })).sort((a, b) => b.units - a.units);
        const DCOL = [{ key: 'name', label: 'Distributor', fmt: 'str' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'sales', label: 'Sales', fmt: 'money' }];
        const PCOL = [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'sales', label: 'Sales', fmt: 'money' }];
        const people = [...reps.values()].filter((r) => r.cur.sales || r.cur.invoiced || r.prev.sales || r.months.size && [...r.months.values()].some((x) => x.sales || x.invoiced))
          .map((r) => {
            const invoices = r.invoiceList.sort((a, b) => b.amount - a.amount);
            const invOf = (cust) => invoices.filter((x) => x.customer === cust);
            const prodRows = (m) => [...(m || new Map()).entries()].map(([name, g]) => ({ name, units: g.units, sales: g.sales })).sort((a, b) => b.units - a.units);
            const cityOf = (c) => [...(r.custCity.get(c) || new Map()).entries()].sort((a, b) => b[1].n - a[1].n)[0]?.[0] || 'Unknown';
            const custs = list(r.customers).map((g) => { const inv = invOf(g.name); return { ...g, city: cityOf(g.name), invoices: inv.length, invoiced: inv.reduce((a, x) => a + x.amount, 0),
              breakdown: { plain: true, summary: [{ l: 'Invoices', v: inv.length, f: 'int' }, { l: 'Invoiced', v: inv.reduce((a, x) => a + x.amount, 0), f: 'money' }, { l: 'Products bought', v: (r.custProd.get(g.name) || new Map()).size, f: 'int' }, { l: 'Units', v: g.units, f: 'int' }],
                columns: [{ key: 'name', label: 'Invoice', fmt: 'str' }, { key: 'date', label: 'Date', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }, { key: 'status', label: 'Payment', fmt: 'str' }], rows: inv.slice(0, 60), more: Math.max(0, inv.length - 60), note: inv.length ? undefined : 'No invoices for this distributor in this period.',
                extra: [{ title: 'Units per product', columns: PCOL, rows: prodRows(r.custProd.get(g.name)).slice(0, 60) }] } }; });
            const prods = list(r.prods).map((g) => { const d = distRows(r.prodDist.get(g.name)); return { ...g, distributors: d.length, breakdown: { plain: true, summary: [{ l: 'Distributors', v: d.length, f: 'int' }, { l: 'Units', v: g.units, f: 'int' }, { l: 'Orders', v: g.orders, f: 'int' }], columns: DCOL, rows: d.slice(0, 60), more: Math.max(0, d.length - 60) } }; });
            const cities = list(r.cities).map((g) => { const d = distRows(r.cityDist.get(g.name)); return { ...g, distributors: d.length, breakdown: { plain: true, summary: [{ l: 'Distributors', v: d.length, f: 'int' }, { l: 'Units', v: g.units, f: 'int' }], columns: DCOL, rows: d.slice(0, 60), more: Math.max(0, d.length - 60) } }; });
            const allProd = [...r.prods.values()].sort((a, b) => b.units - a.units).map((g) => ({ name: g.name, units: g.units, sales: g.sales, distributors: (r.prodDist.get(g.name) || new Map()).size }));
            const allCust = [...r.customers.values()].sort((a, b) => b.sales - a.sales).map((g) => { const inv = invOf(g.name); return { name: g.name, orders: g.ids && g.ids.size ? g.ids.size : g.orders, units: g.units, sales: g.sales, invoices: inv.length, invoiced: inv.reduce((a, x) => a + x.amount, 0) }; });
            const breakdown = { plain: true, summary: [{ l: 'Distributors', v: allCust.length, f: 'int' }, { l: 'Invoices', v: r.cur.invoices, f: 'int' }, { l: 'Products', v: allProd.length, f: 'int' }, { l: 'Units', v: r.cur.units, f: 'int' }],
              columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'distributors', label: 'Distributors', fmt: 'int' }, { key: 'sales', label: 'Sales', fmt: 'money' }], rows: allProd.slice(0, 60), more: Math.max(0, allProd.length - 60),
              extra: [{ title: 'Distributors and their invoices', columns: [{ key: 'name', label: 'Distributor', fmt: 'str' }, { key: 'invoices', label: 'Invoices', fmt: 'int' }, { key: 'invoiced', label: 'Invoiced', fmt: 'money' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'sales', label: 'Sales', fmt: 'money' }], rows: allCust.slice(0, 60) }] };
            return { name: r.name, distributors: allCust.length, productsCount: allProd.length, cur: r.cur, prev: r.prev, months: [...r.months.values()], cities, customers: custs, products: prods, invoices: invoices.slice(0, 60), breakdown };
          })
          .sort((a, b) => b.cur.sales - a.cur.sales).slice(0, 40);
        const used = order.filter((f) => filled[f]).map((f) => `${metaF[f] ? metaF[f].string : f} (${filled[f]} of ${orders.length} orders)`);
        return { people, empty: 'No confirmed orders in the last 12 months.', source: used.length ? 'Salesperson read from: ' + used.join(', ') + '.' : 'No salesperson is filled in on the orders of the last 12 months.' };
      }, 'Salesperson is the one on the sales order (and on the invoice). Amounts are before tax. City is taken from the delivery address on the order (the customer address when there is none), and the distributor is the customer on the order. The lists follow the dates you picked; the month chart always shows the last 12 months.'),
  ];


  if (tab === 'profit') {
    const pn = (v) => (typeof v === 'number' ? v : 0);
    let adsMemo; const ads = () => (adsMemo ||= adSpend({ refresh: false }, ctx.currency));
    let costMemo;
    // Sold lines for any dates, with each product's Odoo cost. Orders confirmed in Odoo, amounts before tax.
    const lines = async (a, b) => {
      const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(a)], ['order_id.date_order', '<=', dtEnd(b)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 20000 });
      const m = new Map();
      for (const l of list) { const pid = nid(l.product_id) || 0, g = m.get(pid) || { pid, name: nm(l.product_id) || 'Other', units: 0, rev: 0 }; g.units += n0(l.product_uom_qty); g.rev += n0(l.price_subtotal); m.set(pid, g); }
      const costs = await costInfo([...m.keys()]);
      return [...m.values()].map((g) => { const c = costs.get(g.pid) || {}; const u = c.cost > 0 ? c.cost : null; return { pid: g.pid, name: String(g.name).replace(/^\s*\[[^\]]*\]\s*/, ''), title: String(g.name).replace(/^\s*\[[^\]]*\]\s*/, ''), sku: c.code || '', units: g.units, rev: g.rev, unit: u, cost: u !== null ? u * g.units : null }; }).sort((x, y) => y.rev - x.rev);
    };
    const costInfo = async (ids) => {
      const out = new Map(); const list = ids.filter(Boolean); if (!list.length) return out;
      try { const got = await call(cfg, 'product.product', 'read', [list, ['standard_price', 'default_code']], { context: { lang: 'en_US' } }); for (const g of got) out.set(g.id, { cost: g.standard_price, code: g.default_code || '' }); } catch (err) { /* costs stay unknown */ }
      return out;
    };
    const figures = async (a, b) => {
      const L = await lines(a, b); let rev = 0, cost = 0, known = 0;
      for (const l of L) { rev += l.rev; if (l.cost !== null) { cost += l.cost; known += l.rev; } }
      return { rev, cost, cover: rev ? (known / rev) * 100 : null, lines: L };
    };
    // 12 months of figures for the chart and the table
    const monthRows = async () => {
      const m12 = monthsBack(12), start = m12[0] + '-01';
      const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(start)]], ['product_id', 'product_uom_qty', 'price_subtotal', 'order_id'], { app: 'Sales', limit: 40000 });
      const ords = await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['date_order'], { app: 'Sales', limit: 20000 });
      const when = new Map(ords.map((o) => [o.id, mkey(o.date_order)]));
      const costs = await costInfo([...new Set(list.map((l) => nid(l.product_id)).filter(Boolean))]);
      const a = await ads(); const spend = a.monthly ? await a.monthly(start, today) : new Map();
      const by = new Map(m12.map((k) => [k, { revenue: 0, cost: 0 }]));
      for (const l of list) { const k = when.get(nid(l.order_id)); const row = by.get(k); if (!row) continue; row.revenue += n0(l.price_subtotal); const c = (costs.get(nid(l.product_id)) || {}).cost; if (c > 0) row.cost += c * n0(l.product_uom_qty); }
      return { rows: m12.map((k) => { const r = by.get(k), ad = spend.get(k) || 0, gross = r.revenue - r.cost; return { key: k, label: label(k), revenue: r.revenue, cost: r.cost, gross, ads: ad, profit: gross - ad }; }), hasAds: !!a.monthly };
    };
    return [
      section('kpi', `Profit after ads (${ctx.monthLabel})`, 'kpi', async () => {
        const [c, p, a] = await Promise.all([figures(s, e), figures(ps, pe), ads()]);
        let s1 = 0, s0 = 0, camps = [];
        if (a.sum) { [s1, s0, camps] = await Promise.all([a.sum(s, e), a.sum(ps, pe), a.byCampaign(s, e).catch(() => [])]); }
        const tiles = profitTiles(c, p, a, s1, s0, camps);
        return { tiles, note: ['Revenue is confirmed sales orders before tax. Product cost is the Cost of each product in Odoo times the units sold; products with no cost set are not counted.', a.off].filter(Boolean).join(' ') };
      }),
      section('trend', 'Last 12 months', 'trend', async () => {
        const { rows, hasAds } = await monthRows();
        return { rows: rows.map((x) => ({ key: x.key, label: x.label, values: { profit: x.profit, revenue: x.revenue, cost: x.cost, gross: x.gross, ads: x.ads } })), selectable: true,
          metrics: [{ key: 'profit', label: hasAds ? 'Profit after ads' : 'Gross profit', fmt: 'money' }, { key: 'revenue', label: 'Net revenue', fmt: 'money' }, { key: 'cost', label: 'Product cost', fmt: 'money' }, ...(hasAds ? [{ key: 'ads', label: 'Ad spend (Meta)', fmt: 'money' }] : [])] };
      }),
      section('months', 'The numbers, month by month', 'table', async () => {
        const { rows, hasAds } = await monthRows();
        const cols = [{ key: 'month', label: 'Month', fmt: 'str' }, { key: 'revenue', label: 'Net revenue', fmt: 'money' }, { key: 'cost', label: 'Product cost', fmt: 'money' }, { key: 'gross', label: 'Gross profit', fmt: 'money' }];
        if (hasAds) cols.push({ key: 'ads', label: 'Ad spend', fmt: 'money' }, { key: 'profit', label: 'Profit after ads', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' });
        return { columns: cols, rows: rows.slice().reverse().map((x) => ({ key: x.key, month: x.label, revenue: x.revenue, cost: x.cost, gross: x.gross, ads: x.ads, profit: x.profit, margin: x.revenue ? pct(x.profit, x.revenue) : null })), empty: 'No sales in these months.' };
      }),
      section('cost', `Cost per product (${ctx.monthLabel})`, 'table', async () => {
        const L = (await lines(s, e)).slice(0, 25);
        const rows = L.map((l) => ({ pid: l.pid, name: l.name, net_sales: l.rev, units: l.units, unitCost: l.unit, cost: l.cost, profit: l.cost !== null ? l.rev - l.cost : null, margin: l.cost !== null && l.rev ? pct(l.rev - l.cost, l.rev) : null }));
        return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'unitCost', label: 'Cost per unit', fmt: 'money2' }, { key: 'cost', label: 'Total cost', fmt: 'money' }, { key: 'profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }], rows: await addPictures(cfg, rows), empty: 'No sales in this period.' };
      }, 'A product with no cost figure has no Cost set in Odoo, so its profit is left blank instead of looking like 100%.'),
    ];
  }

  if (tab === 'sales') return [
    section('kpi', `Sales in ${ctx.monthLabel}`, 'kpi', async () => {
      const so = (a, b, st) => sr(cfg, 'sale.order', [['state', 'in', st], ['date_order', '>=', dt(a)], ['date_order', '<=', dtEnd(b)]], ['name', 'partner_id', 'amount_total', 'date_order'], { app: 'Sales', limit: 20000 });
      const [cur, prev, quotes, inv, pinv, open] = await Promise.all([
        so(s, e, ['sale', 'done']), so(ps, pe, ['sale', 'done']), so(s, e, ['draft', 'sent']),
        invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', s], ['invoice_date', '<=', e]]), invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', ps], ['invoice_date', '<=', pe]]),
        invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]),
      ]);
      const overdue = open.filter((m) => m.invoice_date_due && m.invoice_date_due < today);
      const total = sum(cur, 'amount_total'), days = (d) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000));
      const byCust = groupBy(cur, (o) => nm(o.partner_id) || 'Unknown', () => ({ orders: 0, value: 0 }), (g, o) => { g.orders++; g.value += n0(o.amount_total); }).sort((a, b) => b.value - a.value).map((g) => ({ ...g, share: total ? pct(g.value, total) : null }));
      const invLine = (m) => ({ name: m.name, customer: nm(m.partner_id) || 'Unknown', date: m.invoice_date || '–', amount: amt(m) });
      const owedLine = (m) => ({ name: m.name, customer: nm(m.partner_id) || 'Unknown', due: m.invoice_date_due || '–', owed: resid(m), late: m.invoice_date_due ? days(m.invoice_date_due) : 0 });
      const owedCols = [COL.name('Invoice'), COL.str('customer', 'Customer'), COL.str('due', 'Due'), COL.money('owed', 'Still owed'), { key: 'late', label: 'Days late', fmt: 'days' }];
      return { tiles: [
        tile('Confirmed orders', cur.length, 'int', { prev: (await so(ps, pe, ['sale', 'done'])).length, daily: daily(ctx, cur, prev, (o) => o.date_order, () => 1),
          breakdown: bd([{ l: 'Customers', v: byCust.length, f: 'int' }, { l: 'Average order', v: cur.length ? total / cur.length : 0, f: 'money' }], [COL.name('Order'), COL.str('customer', 'Customer'), COL.str('date', 'Date'), COL.money('value', 'Value')], cur.slice().sort((a, b) => n0(b.amount_total) - n0(a.amount_total)).map((o) => ({ name: o.name, customer: nm(o.partner_id) || 'Unknown', date: String(o.date_order).slice(0, 10), value: n0(o.amount_total) }))) }),
        tile('Order value', total, 'money', { prev: sum(prev, 'amount_total'), daily: daily(ctx, cur, prev, (o) => o.date_order, (o) => n0(o.amount_total)),
          breakdown: bd([{ l: 'Customers', v: byCust.length, f: 'int' }, { l: 'Orders', v: cur.length, f: 'int' }, { l: 'Average order', v: cur.length ? total / cur.length : 0, f: 'money' }], [COL.name('Customer'), COL.int('orders', 'Orders'), COL.money('value', 'Order value'), COL.pct('share', 'Share')], byCust) }),
        tile('Open quotations', quotes.length, 'int', { sub: 'worth ' + Math.round(sum(quotes, 'amount_total')).toLocaleString(), breakdown: bd([{ l: 'Total value', v: sum(quotes, 'amount_total'), f: 'money' }], [COL.name('Quotation'), COL.str('customer', 'Customer'), COL.str('date', 'Date'), COL.money('value', 'Value')], quotes.slice().sort((a, b) => n0(b.amount_total) - n0(a.amount_total)).map((o) => ({ name: o.name, customer: nm(o.partner_id) || 'Unknown', date: String(o.date_order).slice(0, 10), value: n0(o.amount_total) }))) }),
        tile('Invoiced', sum(inv, amt), 'money', { prev: sum(pinv, amt), daily: daily(ctx, inv, pinv, (m) => m.invoice_date, amt),
          breakdown: bd([{ l: 'Invoices', v: inv.length, f: 'int' }], [COL.name('Invoice'), COL.str('customer', 'Customer'), COL.str('date', 'Date'), COL.money('amount', 'Amount')], inv.map(invLine).sort((a, b) => b.amount - a.amount)) }),
        tile('Waiting to be paid', sum(open, resid), 'money', { goodDown: true, sub: open.length + ' invoices', breakdown: bd([{ l: 'Open invoices', v: open.length, f: 'int' }], owedCols, open.map(owedLine).sort((a, b) => b.owed - a.owed)) }),
        tile('Overdue', sum(overdue, resid), 'money', { goodDown: true, sub: overdue.length + ' invoices past their due date', breakdown: bd([{ l: 'Overdue invoices', v: overdue.length, f: 'int' }], owedCols, overdue.map(owedLine).sort((a, b) => b.owed - a.owed)) }),
      ] };
    }),
    section('trend', 'Last 12 months', 'trend', async () => {
      const t = await trend12([
        ['orders', async (start) => (await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['date_order', 'amount_total'], { app: 'Sales', limit: 20000 })).map((r) => ({ ...r, _d: r.date_order })), 'amount_total'],
        ['invoiced', async (start) => (await invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
      ]);
      return { ...t, metrics: [{ key: 'orders', label: 'Order value', fmt: 'money' }, { key: 'invoiced', label: 'Invoiced', fmt: 'money' }], monthBars: { keys: ['orders', 'invoiced'], base: 'orders' } };
    }),
    section('products', `Top products sold (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(s)], ['order_id.date_order', '<=', dtEnd(e)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 20000 });
      const m = new Map(); list.forEach((l) => { const k = nm(l.product_id) || 'Other'; const g = m.get(k) || { name: k, pid: nid(l.product_id), value: 0, units: 0 }; g.value += n0(l.price_subtotal); g.units += n0(l.product_uom_qty); m.set(k, g); });
      const top = [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10);
      const costs = await costsOf(cfg, top.map((g) => g.pid));
      top.forEach((g) => { const c = costs.get(g.pid); if (c !== undefined) { g.cost = c; g.totalCost = c * g.units; g.profit = g.value - g.totalCost; g.margin = g.value ? (g.profit / g.value) * 100 : null; } });
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'value', label: 'Sales (before tax)', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'cost', label: 'Unit cost', fmt: 'money2' }, { key: 'totalCost', label: 'Total cost', fmt: 'money' }, { key: 'profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }], rows: await addPictures(cfg, top), empty: 'No sales lines in this period.' };
    }),
  ];

  const accounting = () => [
    section('kpi', `Money in and out (${ctx.monthLabel})`, 'kpi', async () => {
      const get = (a, b) => Promise.all([invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', a], ['invoice_date', '<=', b]]), invoices(['in_invoice', 'in_refund'], [['invoice_date', '>=', a], ['invoice_date', '<=', b]])]);
      const [[inn, out], [pin, pout]] = await Promise.all([get(s, e), get(ps, pe)]);
      const [recv, pay] = await Promise.all([invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]]), invoices(['in_invoice'], [['payment_state', 'in', ['not_paid', 'partial']]])]);
      const money = (a, b, dir) => sr(cfg, 'account.payment', [['payment_type', '=', dir], ['state', 'in', ['posted', 'paid']], ['date', '>=', a], ['date', '<=', b]], ['amount'], { app: 'Accounting', limit: 20000 }).then((r) => sum(r, 'amount')).catch(() => null);
      const [pr, ps2] = await Promise.all([money(s, e, 'inbound'), money(s, e, 'outbound')]);
      const who = (list, val) => { const t = sum(list, val); return groupBy(list, (m) => nm(m.partner_id) || 'Unknown', () => ({ count: 0, amount: 0 }), (g, m) => { g.count++; g.amount += val(m); }).sort((a, b) => b.amount - a.amount).map((g) => ({ ...g, share: t ? pct(g.amount, t) : null })); };
      const whoCols = (first, c) => [COL.name(first), COL.int('count', c), COL.money('amount', 'Amount'), COL.pct('share', 'Share')];
      const owed = (list) => list.map((m) => ({ name: m.name, who: nm(m.partner_id) || 'Unknown', due: m.invoice_date_due || '–', owed: resid(m) })).sort((a, b) => b.owed - a.owed);
      const owedCols = (w) => [COL.name('Document'), COL.str('who', w), COL.str('due', 'Due'), COL.money('owed', 'Still open')];
      const dIn = daily(ctx, inn, pin, (m) => m.invoice_date, amt), dOut = daily(ctx, out, pout, (m) => m.invoice_date, amt);
      return { tiles: [
        tile('Invoiced to customers', sum(inn, amt), 'money', { prev: sum(pin, amt), daily: dIn, breakdown: bd([{ l: 'Invoices', v: inn.length, f: 'int' }, { l: 'Customers', v: who(inn, amt).length, f: 'int' }], whoCols('Customer', 'Invoices'), who(inn, amt)) }),
        tile('Bills from suppliers', sum(out, amt), 'money', { prev: sum(pout, amt), goodDown: true, daily: dOut, breakdown: bd([{ l: 'Bills', v: out.length, f: 'int' }, { l: 'Suppliers', v: who(out, amt).length, f: 'int' }], whoCols('Supplier', 'Bills'), who(out, amt)) }),
        tile('Difference', sum(inn, amt) - sum(out, amt), 'money', { prev: sum(pin, amt) - sum(pout, amt), sub: 'invoiced minus bills', daily: { ...dIn, cur: dIn.cur.map((v, i) => v - dOut.cur[i]), prev: dIn.prev.map((v, i) => v - dOut.prev[i]) },
          breakdown: { summary: [{ l: 'Invoiced', v: sum(inn, amt), f: 'money' }, { l: 'Bills', v: sum(out, amt), f: 'money' }], columns: [{ key: 'step', label: 'Step', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }], rows: [{ step: 'Invoiced to customers', amount: sum(inn, amt) }, { step: 'Bills from suppliers', amount: -sum(out, amt) }, { step: 'Difference', amount: sum(inn, amt) - sum(out, amt) }], more: 0 } }),
        tile('Customers owe you', sum(recv, resid), 'money', { sub: recv.length + ' open invoices', breakdown: bd([{ l: 'Open invoices', v: recv.length, f: 'int' }], owedCols('Customer'), owed(recv)) }),
        tile('You owe suppliers', sum(pay, resid), 'money', { goodDown: true, sub: pay.length + ' open bills', breakdown: bd([{ l: 'Open bills', v: pay.length, f: 'int' }], owedCols('Supplier'), owed(pay)) }),
        ...(pr !== null ? [tile('Payments received', pr, 'money'), tile('Payments sent', ps2, 'money')] : []),
      ] };
    }, 'These are invoices and bills posted in Odoo. A full profit and loss needs your chart of accounts; ask and I will add it.'),
    section('trend', 'Last 12 months', 'trend', async () => {
      const t = await trend12([
        ['in', async (start) => (await invoices(['out_invoice', 'out_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
        ['out', async (start) => (await invoices(['in_invoice', 'in_refund'], [['invoice_date', '>=', start]])).map((r) => ({ ...r, _d: r.invoice_date })), amt],
      ]);
      t.rows.forEach((r) => { r.values.net = r.values.in - r.values.out; });
      return { ...t, metrics: [{ key: 'in', label: 'Invoiced to customers', fmt: 'money' }, { key: 'out', label: 'Bills from suppliers', fmt: 'money' }, { key: 'net', label: 'Difference', fmt: 'money' }], monthBars: { keys: ['in', 'out', 'net'], base: 'in' } };
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

  /* ---------- Finance: money in and money out share the invoice and bill data ---------- */
  const only = (sec, title, labels, keys) => async () => {
    const r = await sec(); const out = { ...r, title };
    if (r.tiles && labels) out.tiles = r.tiles.filter((t) => labels.includes(t.label));
    if (r.metrics && keys) { out.metrics = r.metrics.filter((m) => keys.includes(m.key)); out.monthBars = { keys, base: keys[0] }; }
    return out;
  };
  if (tab === 'in' || tab === 'out') {
    const [kpi, trend, aging, bills, expenses] = accounting();
    if (tab === 'in') return [
      only(kpi, `Money in (${ctx.monthLabel})`, ['Invoiced to customers', 'Customers owe you', 'Payments received', 'Difference'], null),
      only(trend, 'Invoiced to customers, last 12 months', null, ['in']),
      aging,
    section('overdue', 'Overdue invoices to chase', 'table', async () => {
      const list = (await invoices(['out_invoice'], [['payment_state', 'in', ['not_paid', 'partial']], ['invoice_date_due', '<', today]])).sort((a, b) => resid(b) - resid(a)).slice(0, 12);
      const days = (d) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000));
      return { columns: [{ key: 'name', label: 'Invoice', fmt: 'str' }, { key: 'amount', label: 'Still owed', fmt: 'money', bar: true }, { key: 'late', label: 'Days late', fmt: 'days' }], rows: list.map((m) => ({ name: `${m.name} · ${nm(m.partner_id)}`, amount: resid(m), late: days(m.invoice_date_due) })), empty: 'Nothing is overdue.' };
    }),
    ];
    return [
      only(kpi, `Money out (${ctx.monthLabel})`, ['Bills from suppliers', 'You owe suppliers', 'Payments sent'], null),
      only(trend, 'Bills from suppliers, last 12 months', null, ['out']),
      bills, expenses,
    ];
  }


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
          ...(att ? [tile('Hours worked', hours, 'num1', { sub: att.length + ' check-ins' }), tile('Average per employee', list.length ? hours / list.length : 0, 'num1', { sub: 'hours in this period' })] : []),
          ...(leave ? [tile('Approved time off', sum(leave, 'number_of_days'), 'num1', { sub: 'days touching this period' })] : []),
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
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'suppliers';
  const monthKey = months.includes(req.query.month) ? req.query.month : months[months.length - 1];
  const per = parsePeriod(req.query, TZ) || monthPeriod(monthKey, TZ);
  const month = per.to.slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  // monthLabel is the name every card title uses; it now holds the label of whatever dates were chosen
  const ctx = { month, monthLabel: per.label, compareText: per.compareText, s: per.from, e: per.to, ps: per.compare.from, pe: per.compare.to, today };

  let info = { version: '', company: '', currency: '' };
  const version = await odooVersion(cfg).catch(() => null);   // unreachable server: let the first real call explain
  info.version = version && version.server_version ? version.server_version : '';
  const company = await call(cfg, 'res.company', 'search_read', [[]], { fields: ['name', 'currency_id'], limit: 1 });
  info.company = company[0] ? company[0].name : '';
  info.currency = company[0] && Array.isArray(company[0].currency_id) ? String(company[0].currency_id[1]).slice(0, 3) : '';
  ctx.currency = info.currency;
  const sections = await pool(build(tab, cfg, ctx), 3);
  res.json({ configured: true, tab, month, monthLabel: ctx.monthLabel, period: { from: per.from, to: per.to, days: per.days, label: per.label, kind: per.kind, clamped: per.clamped }, compare: { from: per.compare.from, to: per.compare.to, days: per.compare.days, label: per.compare.label, custom: per.compare.custom }, compareText: per.compareText, months: months.map((k) => ({ key: k, label: label(k) })), currency: info.currency, company: info.company, version: info.version, sections });
});
