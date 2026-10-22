import { route, allow, db, requireAdmin } from './_lib.js';
import { ensureShopSchema, shopConfig, getState, shopifyql } from './_shopify.js';

const DAY = 86400000;

function monthKeyer(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  return (ms) => {
    const p = f.formatToParts(new Date(ms));
    return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value;
  };
}

function lastMonths(keyOf, n) {
  const [y, m] = keyOf(Date.now()).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  return out;
}

const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const top = (map, n, by) => [...map.values()].sort((a, b) => b[by] - a[by]).slice(0, n);

export default route(async (req, res) => {
  allow(req, ['GET']);
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  const cfg = shopConfig();
  if (cfg.missing.length) return res.json({ configured: false, missing: cfg.missing });
  await ensureShopSchema();
  const q = db();
  const keyOf = monthKeyer(cfg.tz);

  const months = lastMonths(keyOf, 12);
  const sel = months.includes(req.query.month) ? req.query.month : months[months.length - 1];
  const prevKey = months[months.indexOf(sel) - 1];

  const since = Date.now() - 400 * DAY;
  const orders = await q`SELECT * FROM shop_orders WHERE created_at >= ${since}`;
  const checkouts = await q`SELECT * FROM shop_checkouts WHERE created_at >= ${Date.now() - 130 * DAY}`;

  // Monthly series (cancelled orders are not sales)
  const series = new Map(months.map((k) => [k, { key: k, label: label(k), orders: 0, revenue: 0, units: 0, refunds: 0 }]));
  for (const o of orders) {
    const m = series.get(keyOf(Number(o.created_at)));
    if (!m || o.cancelled) continue;
    m.orders++; m.revenue += Number(o.total); m.units += o.units; m.refunds += Number(o.refunded);
  }

  // Shopify only returns 60 days of orders without read_all_orders, so older months come from Shopify's own reports.
  const gap = new Set();
  let reportsError = '';
  if (orders.length) {
    const minTs = Math.min(...orders.map((o) => Number(o.created_at)));
    const firstKey = keyOf(minTs), firstDay = Number(new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz, day: '2-digit' }).format(new Date(minTs)));
    months.forEach((k) => { if (k < firstKey || (k === firstKey && firstDay > 3)) gap.add(k); });
  }
  if (gap.size) {
    try {
      const r = await shopifyql(cfg, `FROM sales SHOW total_sales, orders, net_items_sold, sales_reversals TIMESERIES month SINCE ${months[0]}-01 UNTIL ${new Date().toISOString().slice(0, 10)}`);
      for (const row of r.rows) {
        const k = String(row.month).slice(0, 7);
        const m = series.get(k);
        if (!m || !gap.has(k)) continue;
        m.orders = Number(row.orders) || 0; m.revenue = Number(row.total_sales) || 0; m.units = Number(row.net_items_sold) || 0; m.refunds = Math.abs(Number(row.sales_reversals) || 0); m.fromReports = true;
      }
    } catch (e) { reportsError = String(e.message || e).slice(0, 300); }
  }

  // Selected month
  const inMonth = orders.filter((o) => keyOf(Number(o.created_at)) === sel);
  const sales = inMonth.filter((o) => !o.cancelled);
  const revenue = sales.reduce((a, o) => a + Number(o.total), 0);
  const refunds = sales.reduce((a, o) => a + Number(o.refunded), 0);
  const units = sales.reduce((a, o) => a + o.units, 0);
  const cancelled = inMonth.length - sales.length;
  const prev = series.get(prevKey) || { orders: 0, revenue: 0, units: 0 };
  const rep = gap.has(sel) && series.get(sel).fromReports ? series.get(sel) : null;
  const S = rep
    ? { orders: rep.orders, revenue: rep.revenue, refunds: rep.refunds, units: rep.units, cancelled: 0, cancelRate: 0 }
    : { orders: sales.length, revenue, refunds, units, cancelled, cancelRate: inMonth.length ? (cancelled / inMonth.length) * 100 : 0 };

  const products = new Map(), countries = new Map(), cities = new Map();
  const custIds = new Set(), repeatIds = new Set();
  let guest = 0;
  for (const o of sales) {
    for (const it of o.items || []) {
      const p = products.get(it.k) || { title: it.t, units: 0, revenue: 0 };
      p.units += it.q; p.revenue += it.q * it.p; products.set(it.k, p);
    }
    const c = o.country || 'Unknown';
    const cr = countries.get(c) || { name: c, orders: 0, revenue: 0 };
    cr.orders++; cr.revenue += Number(o.total); countries.set(c, cr);
    const cityName = o.city ? o.city + (o.province ? ', ' + o.province : '') : 'Unknown';
    const ci = cities.get(cityName) || { name: cityName, orders: 0, revenue: 0 };
    ci.orders++; ci.revenue += Number(o.total); cities.set(cityName, ci);
    if (o.customer_id) { custIds.add(o.customer_id); if ((o.customer_orders || 0) > 1) repeatIds.add(o.customer_id); } else guest++;
  }

  // Carts left sitting (not completed), newest 90 days
  const now = Date.now();
  const open = checkouts.filter((c) => !c.completed && Number(c.created_at) >= now - 90 * DAY);
  const buckets = [
    { label: 'Under 24 hours', max: 1 * DAY, count: 0, value: 0 },
    { label: '1 to 3 days', max: 3 * DAY, count: 0, value: 0 },
    { label: '3 to 7 days', max: 7 * DAY, count: 0, value: 0 },
    { label: 'Over 7 days', max: Infinity, count: 0, value: 0 },
  ];
  const leftIn = new Map();
  for (const c of open) {
    const age = now - Number(c.created_at);
    const b = buckets.find((x) => age < x.max);
    b.count++; b.value += Number(c.total);
    for (const it of c.items || []) {
      const p = leftIn.get(it.t) || { title: it.t, qty: 0, carts: 0 };
      p.qty += it.q; p.carts++; leftIn.set(it.t, p);
    }
  }
  const monthCarts = checkouts.filter((c) => !c.completed && keyOf(Number(c.created_at)) === sel);
  const cartsValueMonth = monthCarts.reduce((a, c) => a + Number(c.total), 0);

  const [{ n: orderCount }] = await q`SELECT COUNT(*)::int AS n FROM shop_orders`;
  const [{ n: cartCount }] = await q`SELECT COUNT(*)::int AS n FROM shop_checkouts`;
  const so = await getState('orders');
  const sc = await getState('checkouts');
  const currency = (orders.find((o) => o.currency) || {}).currency || '';

  res.json({
    configured: true,
    currency,
    tz: cfg.tz,
    months: [...series.values()],
    month: sel,
    monthLabel: label(sel),
    fromReports: !!rep,
    reportsError,
    summary: {
      orders: S.orders, revenue: S.revenue, refunds: S.refunds, net: S.revenue - S.refunds, units: S.units,
      aov: S.orders ? S.revenue / S.orders : 0,
      refundRate: S.revenue ? (S.refunds / S.revenue) * 100 : 0,
      cancelled: S.cancelled, cancelRate: S.cancelRate,
      change: { orders: pct(S.orders, prev.orders), revenue: pct(S.revenue, prev.revenue), units: pct(S.units, prev.units) },
    },
    bestByUnits: top(products, 10, 'units'),
    bestByRevenue: top(products, 10, 'revenue'),
    countries: top(countries, 10, 'revenue'),
    cities: top(cities, 10, 'revenue'),
    customers: {
      distinct: custIds.size, repeat: repeatIds.size, fresh: custIds.size - repeatIds.size, guest,
      repeatRate: custIds.size ? (repeatIds.size / custIds.size) * 100 : 0,
    },
    abandoned: {
      openCount: open.length,
      openValue: open.reduce((a, c) => a + Number(c.total), 0),
      monthCount: monthCarts.length,
      monthValue: cartsValueMonth,
      monthRate: monthCarts.length + sales.length ? (monthCarts.length / (monthCarts.length + sales.length)) * 100 : 0,
      aging: buckets.map(({ label: l, count, value }) => ({ label: l, count, value })),
      topProducts: top(leftIn, 8, 'qty'),
      oldest: open.sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 10).map((c) => ({
        id: c.id, createdAt: Number(c.created_at), total: Number(c.total), url: c.url,
        items: (c.items || []).map((i) => `${i.q}× ${i.t}`).join(', '), ageHours: Math.round((now - Number(c.created_at)) / 3600000),
      })),
    },
    sync: {
      lastSync: so.lastSync || null,
      inProgress: !!so.runSince,
      orders: orderCount, carts: cartCount,
      note: so.note || '',
      cartsError: sc.error || '',
    },
  });
});
