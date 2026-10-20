import { db, HttpError } from './_lib.js';

/* ---------- config ---------- */
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

export function shopConfig() {
  let shop = (process.env.SHOPIFY_STORE || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (shop && !shop.includes('.')) shop += '.myshopify.com';
  const token = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
  const id = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const secret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
  const missing = [];
  if (!shop) missing.push('SHOPIFY_STORE');
  if (!token && !(id && secret)) missing.push('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)');
  return { shop, token, id, secret, missing, tz: process.env.DASHBOARD_TZ || 'Africa/Cairo' };
}

/* ---------- schema ---------- */
let ready;
export function ensureShopSchema() {
  if (!ready) {
    const q = db();
    ready = (async () => {
      await q`CREATE TABLE IF NOT EXISTS shop_orders (
        id TEXT PRIMARY KEY, name TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        total NUMERIC NOT NULL DEFAULT 0, refunded NUMERIC NOT NULL DEFAULT 0, currency TEXT,
        cancelled BOOLEAN NOT NULL DEFAULT FALSE, country TEXT, province TEXT, city TEXT,
        customer_id TEXT, customer_orders INTEGER, units INTEGER NOT NULL DEFAULT 0, items JSONB NOT NULL DEFAULT '[]'
      )`;
      await q`CREATE INDEX IF NOT EXISTS shop_orders_created ON shop_orders (created_at)`;
      await q`CREATE TABLE IF NOT EXISTS shop_checkouts (
        id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        total NUMERIC NOT NULL DEFAULT 0, currency TEXT, url TEXT, completed BOOLEAN NOT NULL DEFAULT FALSE,
        items JSONB NOT NULL DEFAULT '[]'
      )`;
      await q`CREATE TABLE IF NOT EXISTS shop_state (key TEXT PRIMARY KEY, value JSONB NOT NULL)`;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function getState(key) {
  const rows = await db()`SELECT value FROM shop_state WHERE key = ${key}`;
  return rows[0]?.value || {};
}
export async function setState(key, value) {
  await db()`INSERT INTO shop_state (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/* ---------- Shopify access ---------- */
let cached = { token: '', exp: 0 };
async function accessToken(cfg) {
  if (cfg.token) return cfg.token;
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const r = await fetch(`https://${cfg.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.id, client_secret: cfg.secret }),
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j.access_token) {
    throw new HttpError(502, 'Shopify refused the credentials (' + (j.error_description || j.error || 'HTTP ' + r.status) + '). Check the store name, client ID and secret, and that the app is installed on the store.');
  }
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 86399) * 1000 };
  return cached.token;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(cfg, query, variables) {
  const token = await accessToken(cfg);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://${cfg.shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429) { await wait(1500 * (attempt + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new HttpError(502, 'Shopify denied access (HTTP ' + r.status + '). The app may need more permissions or to be reinstalled.');
    if (r.status === 404) throw new HttpError(502, 'Shopify store not found. Check SHOPIFY_STORE.');
    let j = {};
    try { j = await r.json(); } catch (e) { throw new HttpError(502, 'Shopify returned an unreadable answer (HTTP ' + r.status + ').'); }
    if (j.errors && j.errors.some((e) => e.extensions?.code === 'THROTTLED' || /throttled/i.test(e.message || ''))) { await wait(1500 * (attempt + 1)); continue; }
    return j;
  }
  throw new HttpError(502, 'Shopify is rate limiting requests. Try again in a minute.');
}

const errText = (j) => (j.errors || []).map((e) => e.message).join('; ');
const isAccessDenied = (j) => (j.errors || []).some((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied|not approved|protected customer data/i.test(e.message || ''));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/* ---------- orders ---------- */
const ORDER_BASE = `id name createdAt updatedAt cancelledAt
  totalPriceSet{shopMoney{amount currencyCode}} totalRefundedSet{shopMoney{amount}}
  lineItems(first:20){nodes{title quantity sku product{id} originalUnitPriceSet{shopMoney{amount}}}}`;
const ORDER_PII = ` shippingAddress{country province city} customer{id numberOfOrders}`;
const ordersQuery = (pii) => `query($cursor:String,$q:String){orders(first:25,after:$cursor,query:$q,sortKey:UPDATED_AT){pageInfo{hasNextPage endCursor} nodes{${ORDER_BASE}${pii ? ORDER_PII : ''}}}}`;

async function saveOrder(n) {
  const items = (n.lineItems?.nodes || []).map((l) => ({
    t: l.title, q: l.quantity || 0, p: num(l.originalUnitPriceSet?.shopMoney?.amount), s: l.sku || '', k: l.product?.id || l.title,
  }));
  const units = items.reduce((a, i) => a + i.q, 0);
  await db()`INSERT INTO shop_orders (id, name, created_at, updated_at, total, refunded, currency, cancelled, country, province, city, customer_id, customer_orders, units, items)
    VALUES (${n.id}, ${n.name}, ${Date.parse(n.createdAt)}, ${Date.parse(n.updatedAt)}, ${num(n.totalPriceSet?.shopMoney?.amount)},
      ${num(n.totalRefundedSet?.shopMoney?.amount)}, ${n.totalPriceSet?.shopMoney?.currencyCode || null}, ${!!n.cancelledAt},
      ${n.shippingAddress?.country || null}, ${n.shippingAddress?.province || null}, ${n.shippingAddress?.city || null},
      ${n.customer?.id || null}, ${n.customer?.numberOfOrders != null ? parseInt(n.customer.numberOfOrders, 10) || 0 : null}, ${units}, ${JSON.stringify(items)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, total = EXCLUDED.total, refunded = EXCLUDED.refunded,
      currency = EXCLUDED.currency, cancelled = EXCLUDED.cancelled, country = EXCLUDED.country, province = EXCLUDED.province,
      city = EXCLUDED.city, customer_id = EXCLUDED.customer_id, customer_orders = EXCLUDED.customer_orders,
      units = EXCLUDED.units, items = EXCLUDED.items`;
}

function backfillStart() {
  const months = Math.max(1, Math.min(36, parseInt(process.env.SHOPIFY_MONTHS || '13', 10) || 13));
  const d = new Date();
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

async function syncOrders(cfg, deadline) {
  const st = await getState('orders');
  if (!st.runSince) {
    st.runStarted = new Date().toISOString();
    st.runSince = st.lastSync ? new Date(Date.parse(st.lastSync) - 10 * 60000).toISOString() : backfillStart();
    st.cursor = null; st.count = 0;
  }
  while (true) {
    let j = await gql(cfg, ordersQuery(!st.noPii), { cursor: st.cursor, q: `updated_at:>='${st.runSince}'` });
    if (j.errors && !st.noPii && isAccessDenied(j)) {
      // Customer and address fields need Shopify's protected-customer-data approval. Carry on without them.
      st.noPii = true;
      st.note = 'Shopify has not approved access to customer and address data, so Areas and Customers are empty. Request "protected customer data" access for the app in the Dev Dashboard, then press Sync now again.';
      j = await gql(cfg, ordersQuery(false), { cursor: st.cursor, q: `updated_at:>='${st.runSince}'` });
    }
    if (j.errors || !j.data) throw new HttpError(502, 'Shopify error: ' + errText(j));
    const page = j.data.orders;
    await Promise.all(page.nodes.map(saveOrder));
    st.count += page.nodes.length;
    st.cursor = page.pageInfo.endCursor;
    if (!page.pageInfo.hasNextPage) {
      const count = st.count;
      st.lastSync = st.runStarted; st.runSince = null; st.cursor = null; st.count = 0;
      if (st.noPii && !st.note) st.note = '';
      await setState('orders', st);
      return { done: true, count };
    }
    await setState('orders', st);
    if (Date.now() > deadline) return { done: false, count: st.count };
  }
}

/* ---------- abandoned checkouts ---------- */
const CHECKOUT_QUERY = `query($cursor:String,$q:String){abandonedCheckouts(first:50,after:$cursor,query:$q,sortKey:CREATED_AT,reverse:true){pageInfo{hasNextPage endCursor} nodes{
  id createdAt updatedAt completedAt abandonedCheckoutUrl totalPriceSet{shopMoney{amount currencyCode}}
  lineItems(first:10){nodes{title quantity}}}}}`;

async function syncCheckouts(cfg, deadline) {
  const st = await getState('checkouts');
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  let cursor = null, count = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const j = await gql(cfg, CHECKOUT_QUERY, { cursor, q: `created_at:>='${since}'` });
      if (j.errors || !j.data) throw new Error(errText(j) || 'no data');
      const c = j.data.abandonedCheckouts;
      await Promise.all(c.nodes.map((n) => {
        const items = (n.lineItems?.nodes || []).map((l) => ({ t: l.title, q: l.quantity || 0 }));
        return db()`INSERT INTO shop_checkouts (id, created_at, updated_at, total, currency, url, completed, items)
          VALUES (${n.id}, ${Date.parse(n.createdAt)}, ${Date.parse(n.updatedAt)}, ${num(n.totalPriceSet?.shopMoney?.amount)},
            ${n.totalPriceSet?.shopMoney?.currencyCode || null}, ${n.abandonedCheckoutUrl || null}, ${!!n.completedAt}, ${JSON.stringify(items)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, total = EXCLUDED.total, url = EXCLUDED.url,
            completed = EXCLUDED.completed, items = EXCLUDED.items`;
      }));
      count += c.nodes.length;
      if (!c.pageInfo.hasNextPage || Date.now() > deadline) break;
      cursor = c.pageInfo.endCursor;
    }
    await setState('checkouts', { lastSync: new Date().toISOString(), error: '' });
    return { count, error: '' };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await setState('checkouts', { ...st, error: msg });
    return { count, error: msg };
  }
}

/** One bounded chunk of work (about 40 seconds). Call again while `done` is false. */
export async function syncChunk() {
  const cfg = shopConfig();
  if (cfg.missing.length) throw new HttpError(400, 'Shopify is not connected yet: add ' + cfg.missing.join(', ') + ' in Vercel and redeploy.');
  const deadline = Date.now() + 40000;
  const o = await syncOrders(cfg, deadline);
  if (!o.done) return { done: false, message: `Imported ${o.count} orders so far, continuing…` };
  const c = await syncCheckouts(cfg, deadline);
  return {
    done: true,
    message: `Synced ${o.count} orders and ${c.count} carts.` + (c.error ? ' Carts could not be read: ' + c.error : ''),
  };
}
