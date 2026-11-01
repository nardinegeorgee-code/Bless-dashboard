import { route, allow, requireAdmin } from './_lib.js';
import { odooConfig, odooVersion, call, sr, nm, nid, fieldsOf, needModel } from './_odoo.js';
import { parsePeriod, monthPeriod, dayList } from './_period.js';
import { adSpend, profitTiles } from './_profit.js';

const TZ = process.env.DASHBOARD_TZ || 'Africa/Cairo';

const TABS = ['inventory', 'sales', 'profit', 'accounting', 'hr'];
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
    section('customers', `Top customers (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(s)], ['date_order', '<=', dtEnd(e)]], ['partner_id', 'amount_total'], { app: 'Sales', limit: 20000 });
      const m = new Map(); list.forEach((o) => { const k = nm(o.partner_id) || 'Unknown'; const g = m.get(k) || { name: k, value: 0, orders: 0 }; g.value += n0(o.amount_total); g.orders++; m.set(k, g); });
      return { columns: [{ key: 'name', label: 'Customer', fmt: 'str' }, { key: 'value', label: 'Order value', fmt: 'money', bar: true }, { key: 'orders', label: 'Orders', fmt: 'int' }], rows: [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10), empty: 'No confirmed orders this month.' };
    }),
    section('products', `Top products sold (${ctx.monthLabel})`, 'table', async () => {
      const list = await sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(s)], ['order_id.date_order', '<=', dtEnd(e)]], ['product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 20000 });
      const m = new Map(); list.forEach((l) => { const k = nm(l.product_id) || 'Other'; const g = m.get(k) || { name: k, pid: nid(l.product_id), value: 0, units: 0 }; g.value += n0(l.price_subtotal); g.units += n0(l.product_uom_qty); m.set(k, g); });
      const top = [...m.values()].sort((a, b) => b.value - a.value).slice(0, 10);
      const costs = await costsOf(cfg, top.map((g) => g.pid));
      top.forEach((g) => { const c = costs.get(g.pid); if (c !== undefined) { g.cost = c; g.totalCost = c * g.units; g.profit = g.value - g.totalCost; g.margin = g.value ? (g.profit / g.value) * 100 : null; } });
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'value', label: 'Sales (before tax)', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'cost', label: 'Unit cost', fmt: 'money2' }, { key: 'totalCost', label: 'Total cost', fmt: 'money' }, { key: 'profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }], rows: await addPictures(cfg, top), empty: 'No sales lines in this period.' };
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
      section('reps', 'Sales by salesperson', 'reps', async () => {
        const m12 = monthsBack(12), start = [ps, s, m12[0] + '-01'].sort()[0];
        const [orders, lines, invs] = await Promise.all([
          sr(cfg, 'sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', dt(start)]], ['name', 'partner_id', 'user_id', 'amount_untaxed', 'date_order'], { app: 'Sales', limit: 30000 }),
          sr(cfg, 'sale.order.line', [['order_id.state', 'in', ['sale', 'done']], ['order_id.date_order', '>=', dt(start)]], ['order_id', 'product_id', 'product_uom_qty', 'price_subtotal'], { app: 'Sales', limit: 60000 }),
          sr(cfg, 'account.move', [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'], ['invoice_date', '>=', start]], ['name', 'partner_id', 'invoice_user_id', 'move_type', 'invoice_date', 'amount_untaxed_signed', 'payment_state'], { app: 'Accounting', limit: 30000 }),
        ]);
        const pids = [...new Set(orders.map((o) => nid(o.partner_id)).filter(Boolean))], city = new Map();
        for (let i = 0; i < pids.length; i += 500) {
          try { for (const g of await call(cfg, 'res.partner', 'read', [pids.slice(i, i + 500), ['city', 'state_id']])) city.set(g.id, (g.city || '').trim() || nm(g.state_id) || 'Unknown'); } catch (err) { break; }
        }
        const who = (o) => nm(o.user_id) || 'No salesperson', inR = (d, a, b) => d >= a && d <= b;
        const info = new Map(orders.map((o) => [o.id, { rep: who(o), day: String(o.date_order).slice(0, 10), customer: nm(o.partner_id) || 'Unknown', city: city.get(nid(o.partner_id)) || 'Unknown' }]));
        const reps = new Map(); const R = (name) => { if (!reps.has(name)) reps.set(name, { name, cur: { sales: 0, orders: 0, units: 0, invoiced: 0, invoices: 0 }, prev: { sales: 0, orders: 0, units: 0, invoiced: 0, invoices: 0 }, months: new Map(m12.map((k) => [k, { key: k, label: label(k), sales: 0, orders: 0, units: 0, invoiced: 0 }])), cities: new Map(), customers: new Map(), prods: new Map(), invoiceList: [] }); return reps.get(name); };
        const bump = (map, key, f) => { const g = map.get(key) || { name: key, orders: 0, units: 0, sales: 0, ids: new Set() }; f(g); map.set(key, g); };
        for (const o of orders) {
          const i = info.get(o.id), r = R(i.rep), v = n0(o.amount_untaxed), k = i.day.slice(0, 7), mo = r.months.get(k);
          if (mo) { mo.sales += v; mo.orders++; }
          const w = inR(i.day, s, e) ? r.cur : inR(i.day, ps, pe) ? r.prev : null;
          if (w) { w.sales += v; w.orders++; }
          if (w === r.cur) { for (const [map, key] of [[r.cities, i.city], [r.customers, i.customer]]) bump(map, key, (g) => { g.orders++; g.sales += v; }); }
        }
        for (const l of lines) {
          const i = info.get(nid(l.order_id)); if (!i) continue; const r = R(i.rep), q = n0(l.product_uom_qty), v = n0(l.price_subtotal), mo = r.months.get(i.day.slice(0, 7));
          if (mo) mo.units += q;
          const w = inR(i.day, s, e) ? r.cur : inR(i.day, ps, pe) ? r.prev : null;
          if (w) w.units += q;
          if (w === r.cur) { bump(r.cities, i.city, (g) => { g.units += q; }); bump(r.customers, i.customer, (g) => { g.units += q; }); bump(r.prods, nm(l.product_id) || 'Other', (g) => { g.units += q; g.sales += v; g.ids.add(i.rep + '|' + nid(l.order_id)); }); }
        }
        for (const m of invs) {
          const r = R(nm(m.invoice_user_id) || 'No salesperson'), d = String(m.invoice_date), v = (m.move_type === 'out_refund' ? -1 : 1) * Math.abs(n0(m.amount_untaxed_signed)), mo = r.months.get(d.slice(0, 7));
          if (mo) mo.invoiced += v;
          const w = inR(d, s, e) ? r.cur : inR(d, ps, pe) ? r.prev : null;
          if (w) { w.invoiced += v; w.invoices++; }
          if (w === r.cur) r.invoiceList.push({ name: m.name, customer: nm(m.partner_id) || 'Unknown', date: d, amount: v, status: String(m.payment_state || '').replace(/_/g, ' ') || '–' });
        }
        const list = (map) => [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, 40).map((g) => ({ name: g.name, sales: g.sales, orders: g.ids && g.ids.size ? g.ids.size : g.orders, units: g.units }));
        const people = [...reps.values()].filter((r) => r.cur.sales || r.cur.invoiced || r.prev.sales || r.months.size && [...r.months.values()].some((x) => x.sales || x.invoiced))
          .map((r) => ({ name: r.name, cur: r.cur, prev: r.prev, months: [...r.months.values()], cities: list(r.cities), customers: list(r.customers), products: list(r.prods), invoices: r.invoiceList.sort((a, b) => b.amount - a.amount).slice(0, 60) }))
          .sort((a, b) => b.cur.sales - a.cur.sales).slice(0, 40);
        return { people, empty: 'No confirmed orders in the last 12 months.' };
      }, 'Salesperson is the one on the sales order (and on the invoice). Amounts are before tax. City is the customer city in Odoo, and the distributor is the customer on the order. The lists follow the dates you picked; the month chart always shows the last 12 months.'),
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
