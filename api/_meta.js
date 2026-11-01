import { createHash } from 'node:crypto';
import { db, HttpError } from './_lib.js';
import { ensureShopSchema } from './_shopify.js';

/** Meta (Facebook/Instagram) Ads connection. Settings come from Vercel environment variables, never from the code. */
const GRAPH = 'https://graph.facebook.com';
const CACHE_MS = 15 * 60 * 1000;

export function metaConfig() {
  const token = String(process.env.META_ACCESS_TOKEN || '').trim();
  // Accept "act_123", "123" or a pasted "Ad account ID: 123" and keep only the digits.
  const account = String(process.env.META_AD_ACCOUNT_ID || '').replace(/^\s*act_/i, '').replace(/\D/g, '');
  const version = String(process.env.META_API_VERSION || 'v23.0').trim().replace(/^(?!v)/, 'v');
  const missing = [];
  if (!token) missing.push('META_ACCESS_TOKEN');
  if (!account) missing.push('META_AD_ACCOUNT_ID');
  return { token, account, version, missing, tz: process.env.DASHBOARD_TZ || 'Africa/Cairo' };
}

/* ---------- errors ---------- */
function metaError(e) {
  const code = Number(e.code), msg = String(e.error_user_msg || e.message || 'Meta returned an error').split('\n')[0].slice(0, 300);
  if (code === 190) return new HttpError(502, 'Meta rejected the access token (it has expired or was revoked). Create a new long-lived token and update META_ACCESS_TOKEN in Vercel, then redeploy.');
  if ([10, 200, 299, 294].includes(code) || (code >= 200 && code < 300)) return new HttpError(502, 'Meta says this token is not allowed to do that: ' + msg + ' The token needs ads_read (and ads_management to pause campaigns or change budgets), and its user must have access to this ad account.');
  if ([4, 17, 32, 613, 80000, 80003, 80004].includes(code)) return new HttpError(502, 'Meta is limiting requests right now. Wait a few minutes, then press Refresh numbers.');
  if (code === 100) return new HttpError(502, 'Meta did not accept the request: ' + msg + ' Check META_AD_ACCOUNT_ID.');
  return new HttpError(502, 'Meta error' + (code ? ' ' + code : '') + ': ' + msg);
}

/** One Graph API call. The token goes in the Authorization header, so it never appears in a URL or a log. */
export async function graph(cfg, method, path, params = {}) {
  const url = new URL(`${GRAPH}/${cfg.version}/${String(path).replace(/^\/+/, '')}`);
  const headers = { Authorization: 'Bearer ' + cfg.token };
  const enc = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
  let body;
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, enc(v));
  } else {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, enc(v));
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  let r;
  try { r = await fetch(url, { method, headers, body }); } catch (e) { throw new HttpError(502, 'Could not reach Meta (graph.facebook.com). Try again in a moment.'); }
  let j;
  try { j = await r.json(); } catch (e) { throw new HttpError(502, 'Meta returned an unreadable answer (HTTP ' + r.status + ').'); }
  if (j && j.error) throw metaError(j.error);
  return j;
}

/** Follows paging with the cursor only (the "next" link Meta returns contains the token, so it is never used). */
export async function graphAll(cfg, path, params, maxPages = 8) {
  const out = [];
  let after;
  for (let i = 0; i < maxPages; i++) {
    const j = await graph(cfg, 'GET', path, { ...params, ...(after ? { after } : {}) });
    out.push(...(j.data || []));
    after = j.paging && j.paging.cursors && j.paging.cursors.after;
    if (!(j.paging && j.paging.next) || !after) break;
  }
  return out;
}

/* ---------- schema, cache, audit ---------- */
let ready;
export function ensureMetaSchema() {
  if (!ready) {
    ready = (async () => {
      await ensureShopSchema();   // creates shop_cache, which Meta numbers are cached in
      await db()`CREATE TABLE IF NOT EXISTS meta_audit (
        id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, action TEXT NOT NULL,
        object_id TEXT NOT NULL, object_name TEXT, detail JSONB NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL
      )`;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function cached(cfg, key, refresh, fn) {
  await ensureMetaSchema();
  const q = db();
  const k = 'meta:' + createHash('sha1').update(cfg.account + '|' + cfg.version + '|' + key).digest('hex');
  if (!refresh) {
    const rows = await q`SELECT fetched_at, payload FROM shop_cache WHERE key = ${k}`;
    if (rows[0] && Date.now() - Number(rows[0].fetched_at) < CACHE_MS) return rows[0].payload;
  }
  const v = await fn();
  await q`INSERT INTO shop_cache (key, fetched_at, payload) VALUES (${k}, ${Date.now()}, ${JSON.stringify(v)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, payload = EXCLUDED.payload`;
  return v;
}

export async function clearMetaCache() {
  await ensureMetaSchema();
  await db()`DELETE FROM shop_cache WHERE key LIKE 'meta:%'`;
}

export async function audit(user, action, objectId, objectName, detail) {
  await ensureMetaSchema();
  await db()`INSERT INTO meta_audit (user_id, username, action, object_id, object_name, detail, created_at)
    VALUES (${user.id}, ${user.username}, ${action}, ${objectId}, ${objectName || ''}, ${JSON.stringify(detail || {})}::jsonb, ${Date.now()})`;
}

export async function recentAudit(limit = 15) {
  await ensureMetaSchema();
  return db()`SELECT username, action, object_id, object_name, detail, created_at FROM meta_audit ORDER BY created_at DESC LIMIT ${limit}`;
}

/* ---------- reading numbers ---------- */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];   // the first one present wins, so a purchase is never counted twice
const MESSAGES = ['onsite_conversion.messaging_conversation_started_7d'];
function pick(list, types) {
  if (!Array.isArray(list)) return 0;
  for (const t of types) { const a = list.find((x) => x.action_type === t); if (a) return num(a.value); }
  return 0;
}

export const INSIGHT_FIELDS = 'spend,impressions,reach,inline_link_clicks,actions,action_values';

/** Turns one Meta insights row into the numbers the dashboard shows. */
export function metrics(row) {
  const r = row || {};
  const spend = num(r.spend), impressions = num(r.impressions), clicks = num(r.inline_link_clicks);
  const purchases = pick(r.actions, PURCHASE), value = pick(r.action_values, PURCHASE);
  return {
    spend, impressions, reach: num(r.reach), clicks, purchases, value, messages: pick(r.actions, MESSAGES),
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc: clicks ? spend / clicks : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    roas: spend ? value / spend : 0,
    cpp: purchases ? spend / purchases : 0,
  };
}

export function accountInfo(cfg, refresh) {
  return cached(cfg, 'account', refresh, async () => {
    const a = await graph(cfg, 'GET', 'act_' + cfg.account, { fields: 'name,currency,account_status,timezone_name' });
    return { name: a.name || '', currency: a.currency || '', status: Number(a.account_status) || 0, timezone: a.timezone_name || '' };
  });
}

export const ACCOUNT_STATUS = { 1: 'Active', 2: 'Disabled', 3: 'Payment issue', 7: 'In risk review', 8: 'Payment settling', 9: 'Grace period', 100: 'Closing', 101: 'Closed', 201: 'Any active', 202: 'Any closed' };

/** Currencies where Meta counts budgets in whole units instead of hundredths. */
const WHOLE_UNIT = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export const budgetOffset = (currency) => (WHOLE_UNIT.has(String(currency).toUpperCase()) ? 1 : 100);
