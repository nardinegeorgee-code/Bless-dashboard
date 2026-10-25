import { HttpError } from './_lib.js';

/** Odoo connection settings come from Vercel environment variables, never from the code. */
// If the web address was typed in the database box, use its first part (blees.odoo.com -> blees).
function dbName(v, url) {
  if (!v) return v;
  if (/^https?:\/\//i.test(v) || v.includes('/') || /\.odoo\.com$/i.test(v)) {
    const host = v.replace(/^https?:\/\//i, '').split('/')[0];
    return /\.odoo\.com$/i.test(host) ? host.split('.')[0] : host;
  }
  return v;
}

export function odooConfig() {
  const clean = (v) => String(v || '').trim();
  let url = clean(process.env.ODOO_URL).replace(/\/+$/, '').replace(/\/(odoo|web)(\/.*)?$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const cfg = { url, db: dbName(clean(process.env.ODOO_DB), url), login: clean(process.env.ODOO_LOGIN), key: clean(process.env.ODOO_API_KEY) };
  cfg.missing = [['ODOO_URL', cfg.url], ['ODOO_DB', cfg.db], ['ODOO_LOGIN', cfg.login], ['ODOO_API_KEY', cfg.key]].filter(([, v]) => !v).map(([k]) => k);
  return cfg;
}

async function rpc(cfg, service, method, args) {
  let r;
  try {
    r = await fetch(cfg.url + '/jsonrpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
    });
  } catch (e) { throw new HttpError(502, 'Could not reach Odoo at ' + cfg.url + '. Check ODOO_URL.'); }
  if (r.status === 404) throw new HttpError(502, 'Odoo answered "not found" at ' + cfg.url + '/jsonrpc. Check ODOO_URL: use the address you log in at, without any path.');
  let j;
  try { j = await r.json(); } catch (e) { throw new HttpError(502, 'Odoo returned an unreadable answer (HTTP ' + r.status + '). Check ODOO_URL.'); }
  if (j.error) {
    const msg = (j.error.data && (j.error.data.message || j.error.data.name)) || j.error.message || 'Odoo error';
    throw new Error(String(msg).split('\n')[0].slice(0, 300));
  }
  return j.result;
}

let session = { sig: '', uid: 0 };
async function userId(cfg) {
  const sig = [cfg.url, cfg.db, cfg.login, cfg.key].join('|');
  if (session.sig === sig && session.uid) return session.uid;
  let uid;
  try { uid = await rpc(cfg, 'common', 'authenticate', [cfg.db, cfg.login, cfg.key, {}]); }
  catch (e) {
    if (/does not exist/i.test(e.message)) {
      let names = [];
      try { names = await rpc(cfg, 'db', 'list', []); } catch (x) { /* listing is switched off on many servers */ }
      throw new HttpError(502, `There is no Odoo database called "${cfg.db}". ` + (names.length ? 'The databases on this server are: ' + names.join(', ') + '. Put the right one in ODOO_DB.' : 'This server hides its database list. In Odoo, open Settings, then Activate the developer mode, and the database name shows in the About box; or ask whoever installed Odoo.'));
    }
    throw e;
  }
  if (!uid) throw new HttpError(502, 'Odoo refused the login. Check ODOO_DB, ODOO_LOGIN and that ODOO_API_KEY is an API key created by that user.');
  session = { sig, uid };
  return uid;
}

export async function odooVersion(cfg) { return rpc(cfg, 'common', 'version', []); }

export async function call(cfg, model, method, args = [], kwargs = {}) {
  const uid = await userId(cfg);
  return rpc(cfg, 'object', 'execute_kw', [cfg.db, uid, cfg.key, model, method, args, kwargs]);
}

const fieldCache = new Map();
/** Which fields a model really has: Odoo versions differ, and asking for a missing field is an error. */
export async function fieldsOf(cfg, model) {
  const k = cfg.url + '|' + model;
  if (!fieldCache.has(k)) {
    const exists = await call(cfg, 'ir.model', 'search_count', [[['model', '=', model]]]);
    fieldCache.set(k, exists ? new Set(Object.keys(await call(cfg, model, 'fields_get', [], { attributes: ['type'] }))) : null);
  }
  return fieldCache.get(k);
}
export async function needModel(cfg, model, app) {
  const f = await fieldsOf(cfg, model);
  if (!f) throw new Error(`The ${app} app is not installed in your Odoo (missing ${model}).`);
  return f;
}
export async function sr(cfg, model, domain, fields, opts = {}) {
  const have = await needModel(cfg, model, opts.app || model);
  return call(cfg, model, 'search_read', [domain], { fields: fields.filter((f) => have.has(f)), limit: opts.limit || 5000, order: opts.order || undefined, context: { lang: 'en_US' } });
}
export const nm = (v) => (Array.isArray(v) ? String(v[1] || '') : '');
export const nid = (v) => (Array.isArray(v) ? v[0] : v || null);
