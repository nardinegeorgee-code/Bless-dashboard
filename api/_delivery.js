import { gql } from './_shopify.js';

/* Delivery of each Shopify order, read live from Shopify (fulfillments, tracking, shipping lines).
 * "Delivery" tab: every order of the chosen dates. "Without delivery" tab: open orders not shipped yet, whatever their date. */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sum = (list, f) => list.reduce((a, x) => a + num(typeof f === 'function' ? f(x) : x[f]), 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const avg = (list) => { const v = list.filter((x) => x !== null && x !== undefined); return v.length ? sum(v, (x) => x) / v.length : null; };
const days = (a, b) => (a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 86400000) : null);
const human = (t) => String(t || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const tile = (label, value, fmt, extra = {}) => ({ label, value, fmt, ...extra });
const bd = (summary, columns, list, note) => ({ summary, columns, rows: list.slice(0, 600), more: Math.max(0, list.length - 600), note });
const section = (id, title, kind, fn, note) => async () => {
  try { return { id, title, kind, note, ...(await fn()) }; } catch (e) { return { id, title, kind, note, error: String(e.message || e).slice(0, 400) }; }
};
const localDay = (iso, tz) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }); } catch (e) { return String(iso).slice(0, 10); } };
const shift = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const QUERY = (level) => `query($cursor:String,$q:String){orders(first:100,after:$cursor,query:$q,sortKey:CREATED_AT,reverse:true){pageInfo{hasNextPage endCursor} nodes{
  id name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus totalPriceSet{shopMoney{amount currencyCode}}
  ${level >= 1 ? 'shippingAddress{city province}' : ''}
  shippingLines(first:3){nodes{title originalPriceSet{shopMoney{amount}}}}
  fulfillments(first:5){displayStatus createdAt ${level >= 2 ? 'deliveredAt' : ''} trackingInfo{company number}}
}}}`;

const cache = new Map();
async function fetchOrders(cfg, q, maxPages = 14) {
  const hit = cache.get(q); if (hit && Date.now() - hit.t < 120000) return hit.v;
  let level = 2, cursor = null, nodes = [], more = false;
  for (let page = 0; page < maxPages; page++) {
    let j = await gql(cfg, QUERY(level), { cursor, q });
    while ((j.errors || !j.data?.orders) && level > 0) { level--; j = await gql(cfg, QUERY(level), { cursor, q }); }
    if (j.errors || !j.data?.orders) throw new Error((j.errors || []).map((x) => x.message).join('; ') || 'Shopify returned no orders');
    nodes = nodes.concat(j.data.orders.nodes);
    if (!j.data.orders.pageInfo.hasNextPage) break;
    if (page === maxPages - 1) more = true;
    cursor = j.data.orders.pageInfo.endCursor;
  }
  const v = { nodes, more, level };
  cache.set(q, { t: Date.now(), v });
  return v;
}

/** One plain row per order. */
function norm(n, tz, now) {
  const f = n.fulfillments || [], sh = n.shippingLines?.nodes || [];
  const shipped = f.map((x) => x.createdAt).filter(Boolean).sort()[0] || null;
  const deliveredAt = f.map((x) => x.deliveredAt).filter(Boolean).sort().pop() || null;
  const ds = f.map((x) => x.displayStatus);
  const fs = n.displayFulfillmentStatus;
  let status;
  if (n.cancelledAt) status = 'Cancelled';
  else if (fs === 'UNFULFILLED') status = 'Not shipped';
  else if (f.length && (deliveredAt || ds.every((x) => x === 'DELIVERED'))) status = fs === 'PARTIALLY_FULFILLED' ? 'Partly shipped' : 'Delivered';
  else if (ds.includes('OUT_FOR_DELIVERY')) status = 'Out for delivery';
  else if (ds.includes('ATTEMPTED_DELIVERY')) status = 'Delivery attempted';
  else if (ds.includes('FAILURE')) status = 'Failed';
  else if (fs === 'PARTIALLY_FULFILLED') status = 'Partly shipped';
  else if (fs === 'ON_HOLD') status = 'On hold';
  else if (fs === 'SCHEDULED' || fs === 'PENDING_FULFILLMENT') status = 'Scheduled';
  else if (ds.includes('IN_TRANSIT')) status = 'In transit';
  else if (f.length) status = 'Shipped';
  else status = human(fs) || 'Not shipped';
  const track = f.flatMap((x) => x.trackingInfo || []);
  return {
    id: n.id, name: n.name, date: localDay(n.createdAt, tz), createdAt: n.createdAt, city: n.shippingAddress?.city || n.shippingAddress?.province || '–',
    total: num(n.totalPriceSet?.shopMoney?.amount), status, payment: human(n.displayFinancialStatus) || '–', cancelled: !!n.cancelledAt, unfulfilled: fs === 'UNFULFILLED',
    carrier: [...new Set(track.map((t) => t.company).filter(Boolean))].join(', ') || '–', tracking: track.map((t) => t.number).filter(Boolean).join(', ') || '–',
    method: sh.map((x) => x.title).filter(Boolean).join(', ') || '–', fee: sum(sh, (x) => x.originalPriceSet?.shopMoney?.amount),
    shippedOn: shipped ? localDay(shipped, tz) : '–', deliveredOn: deliveredAt ? localDay(deliveredAt, tz) : '–',
    toShip: days(n.createdAt, shipped), toDeliver: days(n.createdAt, deliveredAt), waiting: days(n.createdAt, now),
    isDelivered: status === 'Delivered', onTheWay: ['In transit', 'Shipped', 'Out for delivery', 'Delivery attempted', 'Partly shipped'].includes(status),
  };
}

const C = {
  str: (key, label) => ({ key, label, fmt: 'str' }), money: (key, label) => ({ key, label, fmt: 'money' }), int: (key, label) => ({ key, label, fmt: 'int' }),
  num1: (key, label) => ({ key, label, fmt: 'num1' }),
};
const orderCols = [C.str('name', 'Order'), C.str('date', 'Date'), C.str('city', 'City'), C.str('status', 'Delivery'), C.money('total', 'Total')];
const list = (rows) => rows.map((o) => ({ name: o.name, date: o.date, city: o.city, status: o.status, total: o.total }));

export function buildDelivery(tab, ctx, cfg) {
  const tz = cfg.tz, now = new Date().toISOString();
  if (tab === 'delivery') {
    let memo; const orders = () => (memo ||= (async () => {
      const r = await fetchOrders(cfg, `created_at:>='${shift(ctx.s, -1)}' created_at:<='${shift(ctx.e, 1)}'`);
      return { rows: r.nodes.map((n) => norm(n, tz, now)).filter((o) => o.date >= ctx.s && o.date <= ctx.e), more: r.more, level: r.level };
    })());
    return [
      section('kpi', `Delivery of orders (${ctx.monthLabel})`, 'kpi', async () => {
        const { rows, more, level } = await orders(); const live = rows.filter((o) => !o.cancelled);
        const delivered = live.filter((o) => o.isDelivered), way = live.filter((o) => o.onTheWay), idle = live.filter((o) => o.status === 'Not shipped');
        const toShip = avg(live.map((o) => o.toShip)), toDel = avg(delivered.map((o) => o.toDeliver));
        const fees = live.filter((o) => o.fee > 0);
        return { tiles: [
          tile('Orders', live.length, 'int', { sub: rows.length - live.length ? (rows.length - live.length) + ' cancelled not counted' : undefined, breakdown: bd([{ l: 'Order value', v: sum(live, 'total'), f: 'money' }], orderCols, list(live)) }),
          tile('Delivered', delivered.length, 'int', { sub: pct(delivered.length, live.length).toFixed(0) + '% of orders', breakdown: bd([{ l: 'Delivered', v: delivered.length, f: 'int' }], orderCols, list(delivered)) }),
          tile('On the way', way.length, 'int', { sub: 'shipped, not delivered yet', breakdown: bd([{ l: 'On the way', v: way.length, f: 'int' }], orderCols, list(way)) }),
          tile('Not shipped yet', idle.length, 'int', { goodDown: true, sub: 'no delivery created', breakdown: bd([{ l: 'Order value', v: sum(idle, 'total'), f: 'money' }], orderCols, list(idle)) }),
          tile('Shipping charged', sum(live, 'fee'), 'money', { sub: fees.length + ' orders paid for delivery', breakdown: bd([{ l: 'Orders with a fee', v: fees.length, f: 'int' }, { l: 'Average fee', v: fees.length ? sum(fees, 'fee') / fees.length : 0, f: 'money' }], [C.str('name', 'Order'), C.str('method', 'Shipping method'), C.money('fee', 'Fee'), C.str('city', 'City')], fees.map((o) => ({ name: o.name, method: o.method, fee: o.fee, city: o.city })).sort((a, b) => b.fee - a.fee)) }),
          ...(toShip !== null ? [tile('Days to ship', toShip, 'num1', { goodDown: true, sub: 'order to first shipment, average' })] : []),
          ...(toDel !== null ? [tile('Days to deliver', toDel, 'num1', { goodDown: true, sub: 'order to delivered, average' })] : []),
        ], ...(more ? { note: 'Shopify has more orders than could be read at once. The most recent ones are shown.' } : {}), ...(level < 2 ? { note: 'Your Shopify access does not give delivered dates, so days to deliver are not shown.' } : {}) };
      }, 'Read live from Shopify. Cancelled orders are not counted.'),
      section('carriers', `By carrier (${ctx.monthLabel})`, 'table', async () => {
        const { rows } = await orders(); const live = rows.filter((o) => !o.cancelled && o.carrier !== '–'); const m = new Map();
        for (const o of live) { const g = m.get(o.carrier) || { name: o.carrier, orders: 0, delivered: 0, days: [], fees: 0, list: [] }; g.orders++; if (o.isDelivered) g.delivered++; if (o.toDeliver !== null) g.days.push(o.toDeliver); g.fees += o.fee; g.list.push(o); m.set(o.carrier, g); }
        return { columns: [C.str('name', 'Carrier'), { key: 'orders', label: 'Orders', fmt: 'int', bar: true }, C.int('delivered', 'Delivered'), C.num1('days', 'Days to deliver'), C.money('fees', 'Shipping charged')],
          rows: [...m.values()].sort((a, b) => b.orders - a.orders).map((g) => ({ name: g.name, orders: g.orders, delivered: g.delivered, days: avg(g.days), fees: g.fees, breakdown: { plain: true, summary: [{ l: 'Orders', v: g.orders, f: 'int' }, { l: 'Delivered', v: g.delivered, f: 'int' }], columns: [C.str('name', 'Order'), C.str('date', 'Date'), C.str('city', 'City'), C.str('status', 'Delivery'), C.str('tracking', 'Tracking')], rows: g.list.map((o) => ({ name: o.name, date: o.date, city: o.city, status: o.status, tracking: o.tracking })).slice(0, 300) } })),
          empty: 'No tracking companies were recorded on the orders in this period.' };
      }),
      section('orders', `Every order and its delivery (${ctx.monthLabel})`, 'table', async () => {
        const { rows, more } = await orders();
        return { columns: [C.str('name', 'Order'), C.str('date', 'Date'), C.str('city', 'City'), C.str('status', 'Delivery'), C.str('carrier', 'Carrier'), C.str('tracking', 'Tracking'), C.str('method', 'Shipping method'), C.money('fee', 'Fee'), C.str('shippedOn', 'Shipped'), C.str('deliveredOn', 'Delivered'), C.num1('toDeliver', 'Days to deliver'), C.money('total', 'Total')],
          rows: rows.slice(0, 600), empty: 'No orders in this period.', ...(more || rows.length > 600 ? { note: 'Showing the most recent orders only.' } : {}) };
      }, 'Delivery comes from the fulfillments on each order in Shopify.'),
    ];
  }
  // Without delivery: open orders with nothing shipped, whatever their date.
  let memo; const open = () => (memo ||= (async () => {
    const r = await fetchOrders(cfg, `status:open fulfillment_status:unfulfilled created_at:>='${shift(ctx.today, -180)}'`, 14);
    return { rows: r.nodes.map((n) => norm(n, tz, now)).filter((o) => !o.cancelled && o.unfulfilled && !/voided|refunded/i.test(o.payment)), more: r.more };
  })());
  const waitCols = [C.str('name', 'Order'), C.str('date', 'Date'), C.num1('waiting', 'Days waiting'), C.str('city', 'City'), C.str('payment', 'Payment'), C.money('total', 'Total')];
  const wl = (rows) => rows.map((o) => ({ name: o.name, date: o.date, waiting: o.waiting, city: o.city, payment: o.payment, total: o.total })).sort((a, b) => b.waiting - a.waiting);
  return [
    section('kpi', 'Orders without delivery', 'kpi', async () => {
      const { rows } = await open(); const over = (n) => rows.filter((o) => o.waiting > n);
      return { tiles: [
        tile('Orders without delivery', rows.length, 'int', { goodDown: true, sub: 'open orders, nothing shipped yet', breakdown: bd([{ l: 'Order value', v: sum(rows, 'total'), f: 'money' }], waitCols, wl(rows)) }),
        tile('Value waiting', sum(rows, 'total'), 'money', { goodDown: true, breakdown: bd([{ l: 'Orders', v: rows.length, f: 'int' }], waitCols, wl(rows)) }),
        tile('Waiting over 3 days', over(3).length, 'int', { goodDown: true, breakdown: bd([{ l: 'Value', v: sum(over(3), 'total'), f: 'money' }], waitCols, wl(over(3))) }),
        tile('Waiting over 7 days', over(7).length, 'int', { goodDown: true, breakdown: bd([{ l: 'Value', v: sum(over(7), 'total'), f: 'money' }], waitCols, wl(over(7))) }),
        tile('Oldest waiting', rows.length ? Math.max(...rows.map((o) => o.waiting)) : 0, 'num1', { goodDown: true, sub: 'days since the order was placed' }),
      ] };
    }, 'Open orders from the last 180 days with no delivery created in Shopify, whatever dates are chosen above. Voided and refunded orders are left out.'),
    section('aging', 'How long they have waited', 'table', async () => {
      const { rows } = await open();
      const b = [['Under 1 day', -1, 1], ['1 to 3 days', 1, 3], ['3 to 7 days', 3, 7], ['7 to 14 days', 7, 14], ['Over 14 days', 14, Infinity]].map(([name, lo, hi]) => ({ name, list: rows.filter((o) => o.waiting >= lo && o.waiting < hi) }));
      return { columns: [C.str('name', 'Waiting'), { key: 'value', label: 'Order value', fmt: 'money', bar: true }, C.int('count', 'Orders')],
        rows: b.map((g) => ({ name: g.name, value: sum(g.list, 'total'), count: g.list.length, breakdown: { plain: true, summary: [{ l: 'Orders', v: g.list.length, f: 'int' }], columns: waitCols, rows: wl(g.list).slice(0, 300) } })) };
    }),
    section('orders', 'Orders to ship', 'table', async () => {
      const { rows, more } = await open();
      return { columns: waitCols, rows: wl(rows).slice(0, 600), empty: 'Every open order has a delivery. Nothing is waiting.', ...(more ? { note: 'Showing the most recent orders only.' } : {}) };
    }),
  ];
}
