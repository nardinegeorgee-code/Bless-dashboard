import { createHash } from 'node:crypto';
import { route, allow, db, HttpError, requireAdmin } from './_lib.js';
import { ensureShopSchema, shopConfig, shopifyql, fetchProducts, gql } from './_shopify.js';

const DAY = 86400000;
const TABS = ['sales', 'funnel', 'products', 'experience', 'retention'];
const CACHE_MS = 30 * 60000;

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function monthKeyer(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  return (ms) => { const p = f.formatToParts(new Date(ms)); return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value; };
}
function monthsBack(keyOf, n) {
  const [y, m] = keyOf(Date.now()).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1)); }
  return out;
}
const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthRange = (key, todayStr) => {
  const [y, m] = key.split('-').map(Number);
  const last = ymd(new Date(Date.UTC(y, m, 0)));
  return { s: `${key}-01`, e: last > todayStr ? todayStr : last };
};
const prevKey = (key) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };
const quarterLabel = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return d.getUTCFullYear() + ' Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };

/* ---------- small helpers ---------- */
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const growth = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const median = (arr) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const sumBy = (rows, k) => rows.reduce((a, r) => a + n0(r[k]), 0);

async function cachedQuery(cfg, query, refresh) {
  const key = 'q:' + createHash('sha1').update(query).digest('hex');
  const q = db();
  if (!refresh) {
    const rows = await q`SELECT fetched_at, payload FROM shop_cache WHERE key = ${key}`;
    if (rows[0] && Date.now() - Number(rows[0].fetched_at) < CACHE_MS) return rows[0].payload;
  }
  const res = await shopifyql(cfg, query);
  await q`INSERT INTO shop_cache (key, fetched_at, payload) VALUES (${key}, ${Date.now()}, ${JSON.stringify(res)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, payload = EXCLUDED.payload`;
  return res;
}

async function pool(tasks, size = 4) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
  }));
  return out;
}

/** A section never throws: a failed query becomes an error card so the rest of the tab still loads. */
const section = (id, title, kind, fn, note) => async () => {
  try { return { id, title, kind, note, ...(await fn()) }; }
  catch (e) { return { id, title, kind, note, error: String(e.message || e).slice(0, 400) }; }
};

/* ---------- Shopify-analytics tabs ---------- */
function buildShopifyTabs(tab, ctx, run) {
  const { s, e, ps, pe, trendStart, today, monthLabel } = ctx;
  const per = `SINCE ${s} UNTIL ${e}`;
  const margin = (r) => (n0(r.net_sales) ? pct(n0(r.gross_profit), n0(r.net_sales)) : null);

  if (tab === 'sales') return [
    section('kpi', `Results for ${monthLabel}`, 'kpi', async () => {
      const metrics = 'gross_sales, discounts, sales_reversals, net_sales, orders, net_items_sold, average_order_value, new_customers, returning_customers, gross_profit';
      const [cur, prev] = await Promise.all([
        run(`FROM sales SHOW ${metrics} ${per}`),
        run(`FROM sales SHOW ${metrics} SINCE ${ps} UNTIL ${pe}`),
      ]);
      const c = cur.rows[0] || {}, p = prev.rows[0] || {};
      const t = (lb, k, fmt, extra = {}) => ({ label: lb, value: Math.abs(n0(c[k])), prev: Math.abs(n0(p[k])), fmt, ...extra });
      return { tiles: [
        t('Net revenue', 'net_sales', 'money', { sub: 'after discounts and returns' }),
        t('Gross sales', 'gross_sales', 'money'),
        t('Discounts', 'discounts', 'money', { goodDown: true, sub: pct(Math.abs(n0(c.discounts)), n0(c.gross_sales)).toFixed(1) + '% of gross sales' }),
        t('Returns', 'sales_reversals', 'money', { goodDown: true, sub: pct(Math.abs(n0(c.sales_reversals)), n0(c.gross_sales)).toFixed(1) + '% of gross sales' }),
        t('Orders', 'orders', 'int'),
        t('Units sold', 'net_items_sold', 'int'),
        t('Average order value', 'average_order_value', 'money'),
        t('New customers', 'new_customers', 'int'),
        t('Returning customers', 'returning_customers', 'int'),
        { label: 'Gross profit', value: n0(c.gross_profit), prev: n0(p.gross_profit), fmt: 'money', sub: margin(c) === null ? '' : margin(c).toFixed(1) + '% margin' },
      ] };
    }, 'Profit only counts products that have a cost price (Cost per item) set in Shopify.'),

    section('monthly', 'Last 12 months', 'trend', async () => {
      const r = await run(`FROM sales SHOW net_sales, gross_profit, orders, net_items_sold TIMESERIES month SINCE ${trendStart} UNTIL ${today}`);
      const rows = r.rows.map((x) => ({ key: String(x.month).slice(0, 7), label: label(String(x.month).slice(0, 7)), values: { net_sales: n0(x.net_sales), gross_profit: n0(x.gross_profit), orders: n0(x.orders), units: n0(x.net_items_sold) } }));
      return { rows, metrics: [{ key: 'net_sales', label: 'Net revenue', fmt: 'money' }, { key: 'gross_profit', label: 'Gross profit', fmt: 'money' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'units', label: 'Units sold', fmt: 'int' }], selectable: true };
    }),

    section('quarterly', 'Quarter by quarter', 'table', async () => {
      const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 21); start.setUTCDate(1);
      const r = await run(`FROM sales SHOW net_sales, orders, net_items_sold TIMESERIES quarter SINCE ${ymd(start)} UNTIL ${today}`);
      const rows = r.rows.map((x, i, a) => ({ period: quarterLabel(x.quarter), net_sales: n0(x.net_sales), orders: n0(x.orders), units: n0(x.net_items_sold), growth: i ? growth(n0(x.net_sales), n0(a[i - 1].net_sales)) : null }));
      return { columns: [{ key: 'period', label: 'Quarter', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'growth', label: 'Growth', fmt: 'growth' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }], rows: rows.slice(-8) };
    }),

    section('yearly', 'Year by year', 'table', async () => {
      const r = await run(`FROM sales SHOW net_sales, orders, net_items_sold TIMESERIES year SINCE ${new Date().getUTCFullYear() - 3}-01-01 UNTIL ${today}`);
      const rows = r.rows.map((x, i, a) => ({ period: String(x.year).slice(0, 4), net_sales: n0(x.net_sales), orders: n0(x.orders), units: n0(x.net_items_sold), growth: i ? growth(n0(x.net_sales), n0(a[i - 1].net_sales)) : null }));
      return { columns: [{ key: 'period', label: 'Year', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'growth', label: 'Growth', fmt: 'growth' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }], rows };
    }, 'The current year is partial, so its growth looks lower until the year ends.'),

    section('channel', `Sales by channel (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_sales, orders, net_items_sold, gross_profit GROUP BY sales_channel ${per} ORDER BY net_sales DESC LIMIT 15`);
      const tot = sumBy(r.rows, 'net_sales');
      return { columns: [{ key: 'name', label: 'Channel', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'share', label: 'Share', fmt: 'pct' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'gross_profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }],
        rows: r.rows.map((x) => ({ name: x.sales_channel || 'Unknown', net_sales: n0(x.net_sales), share: pct(n0(x.net_sales), tot), orders: n0(x.orders), units: n0(x.net_items_sold), gross_profit: n0(x.gross_profit), margin: margin(x) })) };
    }, 'Marketplaces and social shops only appear if they are connected to Shopify as sales channels.'),

    section('category', `Revenue and profit by category (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_sales, net_items_sold, gross_profit GROUP BY product_type ${per} ORDER BY net_sales DESC LIMIT 15`);
      const tot = sumBy(r.rows, 'net_sales');
      return { columns: [{ key: 'name', label: 'Category', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'share', label: 'Share', fmt: 'pct' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'gross_profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }],
        rows: r.rows.map((x) => ({ name: x.product_type || 'No category', net_sales: n0(x.net_sales), share: pct(n0(x.net_sales), tot), units: n0(x.net_items_sold), gross_profit: n0(x.gross_profit), margin: margin(x) })) };
    }),

    section('products', `Revenue and profit by product (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_sales, net_items_sold, gross_profit GROUP BY product_title ${per} ORDER BY net_sales DESC LIMIT 15`);
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'net_sales', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'gross_profit', label: 'Profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }],
        rows: r.rows.map((x) => ({ name: x.product_title || 'Unknown', net_sales: n0(x.net_sales), units: n0(x.net_items_sold), gross_profit: n0(x.gross_profit), margin: margin(x) })) };
    }),

    section('discounts', `Discount codes (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM discounts SHOW applied_discounts, discounted_orders GROUP BY discount_code ${per} ORDER BY applied_discounts DESC LIMIT 10`);
      return { columns: [{ key: 'name', label: 'Code', fmt: 'str' }, { key: 'amount', label: 'Discount given', fmt: 'money', bar: true }, { key: 'orders', label: 'Orders', fmt: 'int' }],
        rows: r.rows.map((x) => ({ name: x.discount_code || 'Automatic discount', amount: Math.abs(n0(x.applied_discounts)), orders: n0(x.discounted_orders) })) };
    }),

    section('cancel', `Cancelled orders (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW orders, net_sales GROUP BY is_canceled_order, order_cancellation_reason ${per}`);
      const rows = r.rows.filter((x) => x.is_canceled_order === true || String(x.is_canceled_order).toLowerCase() === 'true' || x.is_canceled_order === 'Yes')
        .map((x) => ({ name: String(x.order_cancellation_reason || 'No reason given').toLowerCase().replace(/_/g, ' '), orders: n0(x.orders), value: n0(x.net_sales) }));
      return { columns: [{ key: 'name', label: 'Reason', fmt: 'str' }, { key: 'orders', label: 'Orders', fmt: 'int', bar: true }, { key: 'value', label: 'Value', fmt: 'money' }], rows, empty: 'No cancelled orders in this month.' };
    }),
  ];

  if (tab === 'funnel') {
    const conv = (x) => ({ sessions: n0(x.sessions), cart: n0(x.sessions_with_cart_additions), done: n0(x.sessions_that_completed_checkout) });
    const groupTable = (title, dim, nameKey) => section(title.id, title.text, 'table', async () => {
      const r = await run(`FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY ${dim} ${per} ORDER BY sessions DESC LIMIT 12`);
      return { columns: [{ key: 'name', label: nameKey, fmt: 'str' }, { key: 'sessions', label: 'Sessions', fmt: 'int', bar: true }, { key: 'cartRate', label: 'Added to cart', fmt: 'pct' }, { key: 'orders', label: 'Purchases', fmt: 'int' }, { key: 'convRate', label: 'Conversion', fmt: 'pct' }],
        rows: r.rows.map((x) => { const c = conv(x); return { name: x[dim] || 'Unknown', sessions: c.sessions, cartRate: pct(c.cart, c.sessions), orders: c.done, convRate: pct(c.done, c.sessions) }; }) };
    });
    return [
      section('funnel', `Where visitors drop off (${monthLabel})`, 'funnel', async () => {
        const r = await run(`FROM sessions SHOW sessions, online_store_visitors, pageviews, products_viewed, products_added_to_cart, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, searches_submitted, bounces ${per}`);
        const x = r.rows[0] || {};
        const S = n0(x.sessions), C = n0(x.sessions_with_cart_additions), K = n0(x.sessions_that_reached_checkout), D = n0(x.sessions_that_completed_checkout);
        return {
          steps: [{ label: 'Sessions', value: S }, { label: 'Added to cart', value: C }, { label: 'Started checkout', value: K }, { label: 'Purchased', value: D }],
          tiles: [
            { label: 'Visitors', value: n0(x.online_store_visitors), fmt: 'int' },
            { label: 'Page views', value: n0(x.pageviews), fmt: 'int' },
            { label: 'Product page views', value: n0(x.products_viewed), fmt: 'int' },
            { label: 'Product to cart rate', value: pct(n0(x.products_added_to_cart), n0(x.products_viewed)), fmt: 'pct', sub: 'products added / products viewed' },
            { label: 'Conversion rate', value: pct(D, S), fmt: 'pct' },
            { label: 'Cart abandonment', value: pct(C - D, C), fmt: 'pct', sub: 'carts that never purchased' },
            { label: 'Checkout abandonment', value: pct(K - D, K), fmt: 'pct', sub: 'started checkout, did not buy' },
            { label: 'Bounce rate', value: pct(n0(x.bounces), S), fmt: 'pct' },
            { label: 'Searches', value: n0(x.searches_submitted), fmt: 'int' },
          ] };
      }),
      section('trend', 'Conversion by month', 'trend', async () => {
        const r = await run(`FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout TIMESERIES month SINCE ${trendStart} UNTIL ${today}`);
        const rows = r.rows.map((x) => ({ key: String(x.month).slice(0, 7), label: label(String(x.month).slice(0, 7)), values: { sessions: n0(x.sessions), conv: pct(n0(x.sessions_that_completed_checkout), n0(x.sessions)), cart: pct(n0(x.sessions_with_cart_additions), n0(x.sessions)) } }));
        return { rows, metrics: [{ key: 'sessions', label: 'Sessions', fmt: 'int' }, { key: 'conv', label: 'Conversion rate', fmt: 'pct' }, { key: 'cart', label: 'Add-to-cart rate', fmt: 'pct' }], selectable: true };
      }),
      groupTable({ id: 'traffic', text: `Traffic sources (${monthLabel})` }, 'referrer_source', 'Source'),
      groupTable({ id: 'device', text: `Mobile vs desktop (${monthLabel})` }, 'session_device_type', 'Device'),
      groupTable({ id: 'landing', text: `Top landing pages (${monthLabel})` }, 'landing_page_path', 'Page'),
      section('speed', `Page speed by device (${monthLabel})`, 'table', async () => {
        const r = await run(`FROM web_performance SHOW page_loads, lcp_p75_ms, inp_p75_ms, p75_cls, ttfb_p75_ms GROUP BY device_type ${per} ORDER BY page_loads DESC LIMIT 6`);
        return { columns: [{ key: 'name', label: 'Device', fmt: 'str' }, { key: 'loads', label: 'Page loads', fmt: 'int' },
          { key: 'lcp', label: 'Main content (LCP)', fmt: 'ms', rate: [2500, 4000] }, { key: 'inp', label: 'Responsiveness (INP)', fmt: 'ms', rate: [200, 500] },
          { key: 'cls', label: 'Layout shift (CLS)', fmt: 'num2', rate: [0.1, 0.25] }, { key: 'ttfb', label: 'Server response (TTFB)', fmt: 'ms', rate: [800, 1800] }],
          rows: r.rows.map((x) => ({ name: x.device_type || 'Unknown', loads: n0(x.page_loads), lcp: n0(x.lcp_p75_ms), inp: n0(x.inp_p75_ms), cls: n0(x.p75_cls), ttfb: n0(x.ttfb_p75_ms) })) };
      }, 'Slowest 25% of visits. Green is good, amber needs work, red is poor (Google Core Web Vitals limits).'),
      section('payments', `Payment attempts and failures (${monthLabel})`, 'table', async () => {
        const r = await run(`FROM payment_attempts SHOW total_payment_attempts, successful_payments, failed_payment_attempts GROUP BY payment_method ${per} ORDER BY total_payment_attempts DESC LIMIT 10`);
        return { columns: [{ key: 'name', label: 'Payment method', fmt: 'str' }, { key: 'total', label: 'Attempts', fmt: 'int', bar: true }, { key: 'ok', label: 'Successful', fmt: 'int' }, { key: 'failed', label: 'Failed', fmt: 'int' }, { key: 'failRate', label: 'Failure rate', fmt: 'pct' }],
          rows: r.rows.map((x) => ({ name: x.payment_method || 'Unknown', total: n0(x.total_payment_attempts), ok: n0(x.successful_payments), failed: n0(x.failed_payment_attempts), failRate: pct(n0(x.failed_payment_attempts), n0(x.total_payment_attempts)) })) };
      }, 'Shopify does not report why a payment failed, only how many did and by which method.'),
      { text: 1, id: 'usability', title: 'Not measurable from Shopify', kind: 'text', items: ['Navigation, search and filter quality, and checkout usability: review the landing pages and abandonment above, then test the store on a phone yourself or with a few customers.', 'Checkout error messages are not exposed by Shopify. Failed payments are counted above.'] },
    ].map((x) => (typeof x === 'function' ? x : async () => x));
  }

  if (tab === 'products') return [
    section('best', `Best sellers (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_items_sold, net_sales GROUP BY product_title ${per} ORDER BY net_items_sold DESC LIMIT 15`);
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int', bar: true }, { key: 'revenue', label: 'Net revenue', fmt: 'money' }], rows: r.rows.map((x) => ({ name: x.product_title || 'Unknown', units: n0(x.net_items_sold), revenue: n0(x.net_sales) })) };
    }),
    section('category', `Category performance (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_items_sold, net_sales, orders GROUP BY product_type ${per} ORDER BY net_sales DESC LIMIT 15`);
      return { columns: [{ key: 'name', label: 'Category', fmt: 'str' }, { key: 'revenue', label: 'Net revenue', fmt: 'money', bar: true }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'orders', label: 'Orders', fmt: 'int' }], rows: r.rows.map((x) => ({ name: x.product_type || 'No category', revenue: n0(x.net_sales), units: n0(x.net_items_sold), orders: n0(x.orders) })) };
    }),
    section('sku', `Top SKUs (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM sales SHOW net_items_sold, net_sales GROUP BY product_variant_sku, product_title ${per} ORDER BY net_items_sold DESC LIMIT 20`);
      return { columns: [{ key: 'sku', label: 'SKU', fmt: 'str' }, { key: 'name', label: 'Product', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int', bar: true }, { key: 'revenue', label: 'Net revenue', fmt: 'money' }], rows: r.rows.map((x) => ({ sku: x.product_variant_sku || 'No SKU', name: x.product_title || '', units: n0(x.net_items_sold), revenue: n0(x.net_sales) })) };
    }),
    section('slow', `Slow movers: in stock but barely selling (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM inventory SHOW inventory_units_sold, ending_inventory_units, days_of_inventory_remaining, ending_inventory_retail_value GROUP BY product_title ${per} ORDER BY inventory_units_sold ASC LIMIT 250`);
      const rows = r.rows.filter((x) => n0(x.ending_inventory_units) > 0).slice(0, 15).map((x) => ({ name: x.product_title || 'Unknown', sold: n0(x.inventory_units_sold), stock: n0(x.ending_inventory_units), days: x.days_of_inventory_remaining === null ? null : n0(x.days_of_inventory_remaining), value: n0(x.ending_inventory_retail_value) }));
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'sold', label: 'Sold', fmt: 'int' }, { key: 'stock', label: 'In stock', fmt: 'int', bar: true }, { key: 'days', label: 'Days of stock', fmt: 'days' }, { key: 'value', label: 'Stock value (retail)', fmt: 'money' }], rows, empty: 'No slow movers found.' };
    }),
    section('stockout', `Stockouts and estimated lost sales (${monthLabel})`, 'table', async () => {
      const r = await run(`FROM inventory SHOW days_out_of_stock, days_in_stock, inventory_units_sold, ending_inventory_units GROUP BY product_title ${per} ORDER BY days_out_of_stock DESC LIMIT 40`);
      const rows = r.rows.filter((x) => n0(x.days_out_of_stock) > 0).slice(0, 15).map((x) => ({ name: x.product_title || 'Unknown', out: n0(x.days_out_of_stock), sold: n0(x.inventory_units_sold), lost: n0(x.days_in_stock) > 0 ? Math.round((n0(x.inventory_units_sold) / n0(x.days_in_stock)) * n0(x.days_out_of_stock)) : null }));
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'out', label: 'Days out of stock', fmt: 'days', bar: true }, { key: 'sold', label: 'Units sold', fmt: 'int' }, { key: 'lost', label: 'Estimated units lost', fmt: 'int' }], rows, empty: 'No stockouts this month.' };
    }, 'Estimate = average units sold per in-stock day multiplied by days out of stock.'),
    section('low', 'Running out soon', 'table', async () => {
      const r = await run(`FROM inventory SHOW days_of_inventory_remaining, ending_inventory_units, inventory_units_sold_per_day GROUP BY product_title ${per} ORDER BY days_of_inventory_remaining ASC LIMIT 250`);
      const rows = r.rows.filter((x) => n0(x.ending_inventory_units) > 0 && x.days_of_inventory_remaining !== null && n0(x.inventory_units_sold_per_day) > 0).slice(0, 15).map((x) => ({ name: x.product_title || 'Unknown', days: n0(x.days_of_inventory_remaining), stock: n0(x.ending_inventory_units), perDay: n0(x.inventory_units_sold_per_day) }));
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'days', label: 'Days of stock left', fmt: 'days', bar: true, barReverse: true }, { key: 'stock', label: 'In stock', fmt: 'int' }, { key: 'perDay', label: 'Sold per day', fmt: 'num1' }], rows, empty: 'Nothing is close to running out.' };
    }),
    section('bundles', 'Bought together (last 12 months)', 'table', async () => {
      const rows = await db()`SELECT items FROM shop_orders WHERE cancelled = false AND created_at >= ${Date.now() - 365 * DAY}`;
      if (!rows.length) throw new Error('No synced orders yet. Open the Overview tab and press Sync now.');
      const pairs = new Map(), single = new Map();
      for (const o of rows) {
        const m = new Map((o.items || []).map((i) => [i.k, i.t]));
        const ks = [...m.keys()].sort();
        ks.forEach((k) => single.set(k, (single.get(k) || 0) + 1));
        for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
          const key = ks[i] + '|' + ks[j]; const p = pairs.get(key) || { a: m.get(ks[i]), b: m.get(ks[j]), ka: ks[i], kb: ks[j], n: 0 }; p.n++; pairs.set(key, p);
        }
      }
      const list = [...pairs.values()].sort((x, y) => y.n - x.n).slice(0, 15).map((p) => ({ name: `${p.a}  +  ${p.b}`, orders: p.n, share: pct(p.n, Math.min(single.get(p.ka), single.get(p.kb))) }));
      return { columns: [{ key: 'name', label: 'Products often in the same order', fmt: 'str' }, { key: 'orders', label: 'Orders together', fmt: 'int', bar: true }, { key: 'share', label: 'Of the rarer product\'s orders', fmt: 'pct' }], rows: list, empty: 'No product pairs found yet.' };
    }, 'Good candidates for bundles, cross-sell and upsell offers.'),
    section('audit', 'Product page quality', 'audit', async () => {
      const list = (await fetchProducts(shopConfigCache)).filter((p) => p.status === 'ACTIVE');
      const rows = list.map((p) => {
        const d = String(p.description || '');
        const media = (p.media?.nodes || []);
        const issues = [];
        if (!d.trim()) issues.push('No description'); else if (d.length < 150) issues.push('Very short description');
        if ((p.mediaCount?.count ?? media.length) < 3) issues.push('Fewer than 3 photos/videos');
        if (!media.some((m) => m.mediaContentType === 'VIDEO' || m.mediaContentType === 'EXTERNAL_VIDEO')) issues.push('No video');
        if (!/ingredient/i.test(d)) issues.push('No ingredients');
        if (!/(how to use|directions|usage|apply|instructions)/i.test(d)) issues.push('No usage instructions');
        if (!/benefit/i.test(d)) issues.push('No benefits');
        if (!p.productType) issues.push('No category');
        return { name: p.title, issues, count: issues.length };
      });
      const bad = rows.filter((r) => r.count).sort((a, b) => b.count - a.count);
      const tally = {};
      rows.forEach((r) => r.issues.forEach((i) => { tally[i] = (tally[i] || 0) + 1; }));
      return { total: rows.length, withIssues: bad.length, tally: Object.entries(tally).sort((a, b) => b[1] - a[1]), worst: bad.slice(0, 15) };
    }, 'A quick checklist based on the words in each description and the number of photos. It cannot judge photo quality or shade accuracy.'),
    { id: 'gaps', title: 'Not available from Shopify', kind: 'text', items: [
      'Product views and conversion by SKU or category: Shopify shows these in Analytics > Reports > Product analytics, but does not expose them per product here.',
      'Pricing versus competitors: needs your own competitor price list.',
      'Ratings and reviews: they live in your reviews app (Judge.me, Loox, etc.), not in Shopify.',
    ] },
  ].map((x) => (typeof x === 'function' ? x : async () => x));

  if (tab === 'experience') return [
    section('delivery', `Delivery speed (${monthLabel})`, 'kpi', async () => {
      const r = await run(`FROM fulfillments SHOW orders_fulfilled, orders_shipped, orders_delivered, median_hours_order_to_fulfillment, median_hours_order_to_shipping, median_hours_order_to_delivery ${per}`);
      const x = r.rows[0] || {};
      return { tiles: [
        { label: 'Orders fulfilled', value: n0(x.orders_fulfilled), fmt: 'int' },
        { label: 'Delivered', value: n0(x.orders_delivered), fmt: 'int', sub: pct(n0(x.orders_delivered), n0(x.orders_fulfilled)).toFixed(0) + '% of fulfilled' },
        { label: 'Order to fulfilled', value: n0(x.median_hours_order_to_fulfillment), fmt: 'hours', goodDown: true, sub: 'median' },
        { label: 'Order to shipped', value: n0(x.median_hours_order_to_shipping), fmt: 'hours', goodDown: true, sub: 'median' },
        { label: 'Order to delivered', value: n0(x.median_hours_order_to_delivery), fmt: 'hours', goodDown: true, sub: 'median' },
      ] };
    }, 'Delivery times need carriers that send tracking updates to Shopify.'),
    section('carrier', 'Delivery by carrier', 'table', async () => {
      const r = await run(`FROM fulfillments SHOW orders_delivered, median_days_order_to_delivery, median_days_shipping_to_delivery GROUP BY shipping_carrier ${per} ORDER BY orders_delivered DESC LIMIT 10`);
      return { columns: [{ key: 'name', label: 'Carrier', fmt: 'str' }, { key: 'delivered', label: 'Delivered', fmt: 'int', bar: true }, { key: 'total', label: 'Days, order to delivery', fmt: 'num1' }, { key: 'transit', label: 'Days in transit', fmt: 'num1' }],
        rows: r.rows.map((x) => ({ name: x.shipping_carrier || 'Unknown', delivered: n0(x.orders_delivered), total: n0(x.median_days_order_to_delivery), transit: n0(x.median_days_shipping_to_delivery) })) };
    }),
    section('city', 'Delivery by city', 'table', async () => {
      const r = await run(`FROM fulfillments SHOW orders_delivered, median_days_order_to_delivery GROUP BY shipping_city ${per} ORDER BY orders_delivered DESC LIMIT 15`);
      return { columns: [{ key: 'name', label: 'City', fmt: 'str' }, { key: 'delivered', label: 'Delivered', fmt: 'int', bar: true }, { key: 'days', label: 'Days, order to delivery', fmt: 'num1' }],
        rows: r.rows.map((x) => ({ name: x.shipping_city || 'Unknown', delivered: n0(x.orders_delivered), days: n0(x.median_days_order_to_delivery) })) };
    }),
    section('returnsKpi', `Returns, refunds and cancellations (${monthLabel})`, 'kpi', async () => {
      const [ret, sal, can] = await Promise.all([
        run(`FROM returns SHOW returned_quantity ${per}`),
        run(`FROM sales SHOW quantity_ordered, sales_reversals, gross_sales, orders ${per}`),
        run(`FROM sales SHOW orders GROUP BY is_canceled_order ${per}`),
      ]);
      const rq = n0((ret.rows[0] || {}).returned_quantity), s = sal.rows[0] || {};
      const cancelled = can.rows.filter((x) => x.is_canceled_order === true || String(x.is_canceled_order).toLowerCase() === 'true' || x.is_canceled_order === 'Yes').reduce((a, x) => a + n0(x.orders), 0);
      const all = can.rows.reduce((a, x) => a + n0(x.orders), 0);
      return { tiles: [
        { label: 'Units returned', value: rq, fmt: 'int' },
        { label: 'Return rate', value: pct(rq, n0(s.quantity_ordered)), fmt: 'pct', goodDown: true, sub: 'units returned / units ordered' },
        { label: 'Refund value', value: Math.abs(n0(s.sales_reversals)), fmt: 'money', goodDown: true },
        { label: 'Cancelled orders', value: cancelled, fmt: 'int', goodDown: true },
        { label: 'Cancellation rate', value: pct(cancelled, all), fmt: 'pct', goodDown: true },
      ] };
    }),
    section('reasons', 'Why customers return items', 'table', async () => {
      const r = await run(`FROM returns SHOW returned_quantity GROUP BY return_line_item_reason ${per} ORDER BY returned_quantity DESC LIMIT 10`);
      const tot = sumBy(r.rows, 'returned_quantity');
      return { columns: [{ key: 'name', label: 'Reason', fmt: 'str' }, { key: 'qty', label: 'Units', fmt: 'int', bar: true }, { key: 'share', label: 'Share', fmt: 'pct' }],
        rows: r.rows.map((x) => ({ name: String(x.return_line_item_reason || 'No reason given').toLowerCase().replace(/_/g, ' '), qty: n0(x.returned_quantity), share: pct(n0(x.returned_quantity), tot) })), empty: 'No returns this month.' };
    }),
    section('returned', 'Most returned products', 'table', async () => {
      const r = await run(`FROM returns SHOW returned_quantity GROUP BY product_title_at_time_of_sale ${per} ORDER BY returned_quantity DESC LIMIT 10`);
      return { columns: [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'qty', label: 'Units returned', fmt: 'int', bar: true }],
        rows: r.rows.map((x) => ({ name: x.product_title_at_time_of_sale || 'Unknown', qty: n0(x.returned_quantity) })), empty: 'No returns this month.' };
    }),
    section('cancelReasons', 'Why orders are cancelled', 'table', async () => {
      const r = await run(`FROM sales SHOW orders GROUP BY is_canceled_order, order_cancellation_reason ${per}`);
      const rows = r.rows.filter((x) => x.is_canceled_order === true || String(x.is_canceled_order).toLowerCase() === 'true' || x.is_canceled_order === 'Yes')
        .map((x) => ({ name: String(x.order_cancellation_reason || 'No reason given').toLowerCase().replace(/_/g, ' '), orders: n0(x.orders) }));
      return { columns: [{ key: 'name', label: 'Reason', fmt: 'str' }, { key: 'orders', label: 'Orders', fmt: 'int', bar: true }], rows, empty: 'No cancelled orders this month.' };
    }),
    async () => ({ id: 'manual', title: `Service scores you enter (${monthLabel})`, kind: 'manual', ...(await manualData(ctx)) }),
    { id: 'gaps', title: 'Not available from Shopify', kind: 'text', items: [
      'Customer satisfaction (CSAT), NPS, support response time and resolution rate: enter them above from your helpdesk or survey tool.',
      'Packaging, product condition and order accuracy: track complaints in the box above; Shopify does not record them.',
      'Ease of finding the right product: see searches and landing pages on the Funnel tab.',
    ] },
  ].map((x) => (typeof x === 'function' ? x : async () => x));

  return [];
}

let shopConfigCache;

/* ---------- manual service scores ---------- */
const MANUAL_FIELDS = [
  { key: 'csat', label: 'Customer satisfaction (CSAT, %)', max: 100 },
  { key: 'nps', label: 'NPS (-100 to 100)', min: -100, max: 100 },
  { key: 'responseHours', label: 'Average first response (hours)', max: 1000 },
  { key: 'resolutionRate', label: 'Resolved on first contact (%)', max: 100 },
  { key: 'complaints', label: 'Complaints received', max: 100000 },
  { key: 'accuracyErrors', label: 'Wrong or damaged orders', max: 100000 },
];
async function manualData(ctx) {
  const rows = await db()`SELECT month, values FROM shop_manual ORDER BY month DESC LIMIT 12`;
  const cur = rows.find((r) => r.month === ctx.month);
  return { month: ctx.month, fields: MANUAL_FIELDS, values: cur ? cur.values : {}, history: rows.slice(0, 6).map((r) => ({ month: r.month, label: label(r.month), values: r.values })) };
}

/* ---------- retention (from your synced orders) ---------- */
async function buildRetention(ctx, keyOf, cfg) {
  const rows = await db()`SELECT id, created_at, total, customer_id, customer_orders, cats FROM shop_orders WHERE customer_id IS NOT NULL AND cancelled = false ORDER BY created_at`;
  const none = () => { throw new Error('No customer orders synced yet. Open the Overview tab, press Sync now, and make sure customer data access is approved.'); };
  const handle = cfg.shop.replace(/\.myshopify\.com$/, '');
  const now = Date.now();

  const cust = new Map();
  for (const o of rows) {
    let c = cust.get(o.customer_id);
    if (!c) { c = { id: o.customer_id, orders: [], spend: 0, life: o.customer_orders, cats: new Map() }; cust.set(o.customer_id, c); }
    const t = Number(o.created_at);
    c.orders.push(t); c.spend += Number(o.total); c.life = o.customer_orders ?? c.life;
    for (const cat of o.cats || []) { const a = c.cats.get(cat) || []; a.push(t); c.cats.set(cat, a); }
  }
  const all = [...cust.values()];
  const complete = all.filter((c) => c.life != null && c.orders.length >= c.life);
  const lifeOrders = (c) => Math.max(c.life || 0, c.orders.length);

  const gaps = [];
  complete.forEach((c) => { for (let i = 1; i < c.orders.length; i++) gaps.push((c.orders[i] - c.orders[i - 1]) / DAY); });
  const spends = complete.map((c) => c.spend);

  const sections = [];
  sections.push(async () => ({ id: 'kpi', title: 'Do customers come back?', kind: 'kpi', ...(!all.length ? none() : {}), tiles: [
    { label: 'Customers with orders', value: all.length, fmt: 'int' },
    { label: 'Repeat purchase rate', value: pct(all.filter((c) => lifeOrders(c) > 1).length, all.length), fmt: 'pct', sub: 'customers with 2+ orders' },
    { label: 'Orders per customer', value: all.reduce((a, c) => a + lifeOrders(c), 0) / all.length, fmt: 'num1' },
    { label: 'Days between orders', value: median(gaps), fmt: 'days', sub: 'median, repeat customers' },
    { label: 'Average lifetime value', value: spends.length ? spends.reduce((a, b) => a + b, 0) / spends.length : 0, fmt: 'money', sub: `${complete.length} customers with full history` },
    { label: 'Median lifetime value', value: median(spends), fmt: 'money' },
  ], note: 'Lifetime value counts order totals (including shipping and taxes) for customers whose whole order history is in your synced data.' }));

  // cohorts
  const cohorts = new Map();
  for (const c of complete) {
    const first = keyOf(c.orders[0]);
    const g = cohorts.get(first) || { key: first, customers: [], };
    g.customers.push(c); cohorts.set(first, g);
  }
  const cohortKeys = [...cohorts.keys()].sort().slice(-12);
  const idx = (key) => { const [y, m] = key.split('-').map(Number); return y * 12 + m; };
  const nowIdx = idx(keyOf(now));
  sections.push(async () => ({ id: 'cohort', title: 'Cohort retention by first-purchase month', kind: 'cohort', note: 'Each row is the customers who bought for the first time in that month. Each cell is the share of them who ordered again N months later.',
    rows: cohortKeys.map((k) => {
      const g = cohorts.get(k); const base = idx(k);
      const cells = Array.from({ length: 12 }, (_, n) => {
        if (base + n > nowIdx) return null;
        const active = g.customers.filter((c) => c.orders.some((t) => idx(keyOf(t)) === base + n)).length;
        return pct(active, g.customers.length);
      });
      return { label: label(k), size: g.customers.length, cells };
    }), empty: 'Not enough full-history customers yet.' }));

  sections.push(async () => ({ id: 'ltv', title: 'Customer value by first-purchase month', kind: 'table', columns: [
    { key: 'name', label: 'First purchase', fmt: 'str' }, { key: 'customers', label: 'Customers', fmt: 'int' },
    { key: 'ltv', label: 'Average value so far', fmt: 'money', bar: true }, { key: 'repeat', label: 'Came back', fmt: 'pct' }, { key: 'orders', label: 'Orders each', fmt: 'num1' }],
    rows: cohortKeys.map((k) => { const cs = cohorts.get(k).customers; return { name: label(k), customers: cs.length, ltv: cs.reduce((a, c) => a + c.spend, 0) / cs.length, repeat: pct(cs.filter((c) => c.orders.length > 1).length, cs.length), orders: cs.reduce((a, c) => a + c.orders.length, 0) / cs.length }; }) }));

  // repurchase by category
  const cat = new Map();
  for (const c of complete) for (const [name, ts] of c.cats) {
    const g = cat.get(name) || { name, buyers: 0, repeat: 0, gaps: [] };
    g.buyers++; if (ts.length > 1) { g.repeat++; for (let i = 1; i < ts.length; i++) g.gaps.push((ts[i] - ts[i - 1]) / DAY); }
    cat.set(name, g);
  }
  sections.push(async () => ({ id: 'category', title: 'Repurchase by category', kind: 'table', note: 'The days between purchases show the best moment for a replenishment reminder.', columns: [
    { key: 'name', label: 'Category', fmt: 'str' }, { key: 'buyers', label: 'Buyers', fmt: 'int' }, { key: 'rate', label: 'Bought it again', fmt: 'pct', bar: true }, { key: 'gap', label: 'Typical days between purchases', fmt: 'days' }],
    rows: [...cat.values()].filter((g) => g.buyers >= 3).sort((a, b) => b.buyers - a.buyers).slice(0, 15).map((g) => ({ name: g.name, buyers: g.buyers, rate: pct(g.repeat, g.buyers), gap: g.gaps.length ? median(g.gaps) : null })), empty: 'Not enough purchases per category yet.' }));

  // RFM-style segments
  const seg = (c) => {
    const r = (now - c.orders[c.orders.length - 1]) / DAY, f = lifeOrders(c);
    if (r <= 60 && f >= 3) return 'Champions';
    if (r <= 120 && f >= 2) return 'Loyal';
    if (f === 1 && r <= 60) return 'New customers';
    if (f === 1 && r <= 120) return 'One order, still warm';
    if (f >= 2 && r <= 365) return 'At risk';
    if (f >= 2) return 'Lost loyal customers';
    return 'One-time, gone quiet';
  };
  const order = ['Champions', 'Loyal', 'New customers', 'One order, still warm', 'At risk', 'Lost loyal customers', 'One-time, gone quiet'];
  const segs = new Map(order.map((n) => [n, []]));
  all.forEach((c) => segs.get(seg(c)).push(c));
  sections.push(async () => ({ id: 'segments', title: 'Customer segments', kind: 'table', note: 'Based on how recently, how often and how much each customer bought. Champions: 3+ orders and bought within 60 days. At risk: 2+ orders, last purchase 4 to 12 months ago.', columns: [
    { key: 'name', label: 'Segment', fmt: 'str' }, { key: 'customers', label: 'Customers', fmt: 'int', bar: true }, { key: 'share', label: 'Share', fmt: 'pct' }, { key: 'orders', label: 'Orders each', fmt: 'num1' }, { key: 'spend', label: 'Spend each', fmt: 'money' }, { key: 'recency', label: 'Days since last order', fmt: 'days' }],
    rows: order.map((n) => { const cs = segs.get(n); return { name: n, customers: cs.length, share: pct(cs.length, all.length), orders: cs.length ? cs.reduce((a, c) => a + lifeOrders(c), 0) / cs.length : 0, spend: cs.length ? cs.reduce((a, c) => a + c.spend, 0) / cs.length : 0, recency: cs.length ? cs.reduce((a, c) => a + (now - c.orders[c.orders.length - 1]) / DAY, 0) / cs.length : null }; }) }));

  // win-back
  const dormant = all.filter((c) => lifeOrders(c) >= 2 && (now - c.orders[c.orders.length - 1]) / DAY > 90);
  const bucket = (lo, hi) => dormant.filter((c) => { const d = (now - c.orders[c.orders.length - 1]) / DAY; return d > lo && d <= hi; });
  sections.push(async () => ({ id: 'winback', title: 'Win-back: repeat customers who stopped ordering', kind: 'table', columns: [
    { key: 'name', label: 'Inactive for', fmt: 'str' }, { key: 'customers', label: 'Customers', fmt: 'int', bar: true }, { key: 'spend', label: 'What they spent before', fmt: 'money' }],
    rows: [['3 to 6 months', 90, 180], ['6 to 12 months', 180, 365], ['Over a year', 365, Infinity]].map(([nm, lo, hi]) => { const cs = bucket(lo, hi); return { name: nm, customers: cs.length, spend: cs.reduce((a, c) => a + c.spend, 0) }; }) }));
  sections.push(async () => ({ id: 'winlist', title: 'Best customers to win back first', kind: 'table', note: 'Click a name to open the customer in Shopify, where you can see their contact details and message them.', columns: [
    { key: 'link', label: 'Customer', fmt: 'link' }, { key: 'orders', label: 'Orders', fmt: 'int' }, { key: 'spend', label: 'Spent', fmt: 'money', bar: true }, { key: 'last', label: 'Last order', fmt: 'str' }, { key: 'ago', label: 'Days ago', fmt: 'days' }],
    rows: dormant.sort((a, b) => b.spend - a.spend).slice(0, 15).map((c) => { const last = c.orders[c.orders.length - 1]; const numeric = String(c.id).split('/').pop(); return { link: { text: 'Customer ' + numeric.slice(-6), href: `https://admin.shopify.com/store/${handle}/customers/${numeric}` }, orders: lifeOrders(c), spend: c.spend, last: ymd(new Date(last)), ago: Math.round((now - last) / DAY) }; }), empty: 'No inactive repeat customers.' }));
  sections.push(async () => ({ id: 'gaps', title: 'Not available from Shopify', kind: 'text', items: [
    'Loyalty program, rewards and referral results: these live in your loyalty or referral app. Use the segments above to decide who to invite.',
    'Replenishment reminders and win-back campaigns: send them from Shopify Email, Klaviyo or similar, using the timing and customer lists above.',
  ] }));
  return sections;
}

/* ---------- route ---------- */
export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  const cfg = shopConfig();
  if (cfg.missing.length) return res.json({ configured: false, missing: cfg.missing });
  await ensureShopSchema();
  shopConfigCache = cfg;
  const keyOf = monthKeyer(cfg.tz);
  const months = monthsBack(keyOf, 12);

  if (req.method === 'POST') {
    const month = months.includes(req.body?.month) ? req.body.month : null;
    if (!month) throw new HttpError(400, 'Choose a month from the list.');
    const values = {};
    for (const f of MANUAL_FIELDS) {
      const raw = req.body?.values?.[f.key];
      if (raw === '' || raw === null || raw === undefined) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v > f.max || v < (f.min ?? 0)) throw new HttpError(400, `${f.label}: enter a number between ${f.min ?? 0} and ${f.max}.`);
      values[f.key] = v;
    }
    await db()`INSERT INTO shop_manual (month, values, updated_at) VALUES (${month}, ${JSON.stringify(values)}::jsonb, ${Date.now()})
      ON CONFLICT (month) DO UPDATE SET values = EXCLUDED.values, updated_at = EXCLUDED.updated_at`;
    return res.json({ ok: true });
  }

  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'sales';
  const month = months.includes(req.query.month) ? req.query.month : months[months.length - 1];
  const refresh = req.query.refresh === '1';
  const today = ymd(new Date());
  const { s, e } = monthRange(month, today);
  const pk = prevKey(month);
  const pr = monthRange(pk, today);
  const ctx = { month, monthLabel: label(month), s, e, ps: pr.s, pe: pr.e, today, trendStart: `${months[0]}-01` };
  const run = (query) => cachedQuery(cfg, query, refresh);

  const tasks = tab === 'retention' ? await buildRetention(ctx, keyOf, cfg).catch((err) => [async () => ({ id: 'err', title: 'Retention', kind: 'text', error: err.message })]) : buildShopifyTabs(tab, ctx, run);
  const wrapped = tab === 'retention' ? tasks.map((fn, i) => async () => { try { return await fn(); } catch (err) { return { id: 'r' + i, title: 'Retention', kind: 'text', error: String(err.message || err).slice(0, 400) }; } }) : tasks;
  const sections = await pool(wrapped, 3);

  let currency = '';
  try { const r = await db()`SELECT currency FROM shop_orders WHERE currency IS NOT NULL LIMIT 1`; currency = r[0]?.currency || ''; } catch (err) {}
  if (!currency) { try { const j = await gql(cfg, '{shop{currencyCode}}'); currency = j.data?.shop?.currencyCode || ''; } catch (err) {} }

  res.json({ configured: true, tab, month, monthLabel: ctx.monthLabel, months: months.map((k) => ({ key: k, label: label(k) })), currency, tz: cfg.tz, sections });
});
