import { db, HttpError } from './_lib.js';

/* The courier sheet: column A order number, column B status, column E shipping fee.
 *  "returned to shipper confirmed" -> the order is taken out of revenue and cost, and its shipping fee is deducted from profit.
 *  "confirmed delivery"            -> the order stays, and its shipping fee is deducted from profit. */
let ready;
export function ensureSheet() {
  if (!ready) {
    ready = (async () => {
      const q = db();
      await q`CREATE TABLE IF NOT EXISTS ship_sheet (order_no TEXT PRIMARY KEY, label TEXT, status TEXT NOT NULL DEFAULT '', fee NUMERIC NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)`;
      await q`ALTER TABLE ship_sheet ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT ''`;
      await q`ALTER TABLE ship_sheet ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''`;
      await q`CREATE TABLE IF NOT EXISTS ship_sheet_log (id TEXT PRIMARY KEY, at BIGINT NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export const normNo = (v) => String(v ?? '').toLowerCase().replace(/[^0-9a-z]/g, '');
export function kindOf(status) {
  const s = String(status || '').toLowerCase();
  if (/return/.test(s) && /shipper|sender|merchant/.test(s)) return 'returned';
  if (/(un|not\s+)deliver|out\s+for\s+delivery|attempt|fail|pending|in\s+transit/.test(s)) return 'other';
  if (/deliver/.test(s)) return 'delivered';
  return 'other';
}
const money = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

/** rows: [[A, B, C, D, E], ...] exactly as in the sheet. A header row (no digits in column A) is skipped.
 *  replace = true swaps the whole saved sheet for these rows. */
export async function saveSheet(rows, who = '', replace = false, source = '') {
  source = String(source || '').trim().slice(0, 80);
  await ensureSheet();
  const out = new Map();
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 20000)) {
    const label = String(r?.[0] ?? '').trim(), no = normNo(label);
    if (!no || !/\d/.test(label)) continue;
    out.set(no, { no, label: label.slice(0, 40), status: String(r?.[1] ?? '').trim().slice(0, 120), fee: Math.max(0, money(r?.[4])) });
  }
  if (!out.size) throw new HttpError(400, 'No orders found. Column A must hold the order number, column B the status and column E the shipping fee.');
  const q = db(), now = Date.now();
  if (replace) await q`DELETE FROM ship_sheet`;
  for (const x of out.values()) {
    await q`INSERT INTO ship_sheet (order_no, label, status, fee, updated_at, updated_by, source) VALUES (${x.no}, ${x.label}, ${x.status}, ${x.fee}, ${now}, ${who}, ${source})
      ON CONFLICT (order_no) DO UPDATE SET label = EXCLUDED.label, status = EXCLUDED.status, fee = EXCLUDED.fee, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by, source = CASE WHEN EXCLUDED.source = '' THEN ship_sheet.source ELSE EXCLUDED.source END`;
  }
  await logSheet(who, replace ? 'Replaced the sheet' : 'Added orders', `${out.size} order${out.size === 1 ? '' : 's'}${source ? ' from "' + source + '"' : ''}`);
  return out.size;
}
export async function clearSheet(who = '') {
  await ensureSheet();
  const [{ n }] = await db()`SELECT COUNT(*)::int AS n FROM ship_sheet`;
  await db()`DELETE FROM ship_sheet`;
  await logSheet(who, 'Cleared the sheet', `${n} order${n === 1 ? '' : 's'} removed`);
}
/** Change the status, fee or order number of one saved order. */
export async function editRow(id, patch, who = '') {
  await ensureSheet();
  const q = db(), key = normNo(id);
  const cur = (await q`SELECT * FROM ship_sheet WHERE order_no = ${key}`)[0];
  if (!cur) throw new HttpError(404, 'That order is no longer in the sheet.');
  const label = patch.label !== undefined ? String(patch.label).trim().slice(0, 40) : cur.label;
  const status = patch.status !== undefined ? String(patch.status).trim().slice(0, 120) : cur.status;
  const fee = patch.fee !== undefined ? Math.max(0, money(patch.fee)) : Number(cur.fee);
  const nk = normNo(label);
  if (!nk || !/\d/.test(label)) throw new HttpError(400, 'The order number needs at least one digit.');
  if (nk !== key && (await q`SELECT 1 FROM ship_sheet WHERE order_no = ${nk}`).length) throw new HttpError(409, 'Another order in the sheet already has that number.');
  await q`UPDATE ship_sheet SET order_no = ${nk}, label = ${label}, status = ${status}, fee = ${fee}, updated_at = ${Date.now()}, updated_by = ${who} WHERE order_no = ${key}`;
  const bits = [];
  if (status !== cur.status) bits.push(`status "${cur.status || '–'}" → "${status || '–'}"`);
  if (fee !== Number(cur.fee)) bits.push(`fee ${Number(cur.fee)} → ${fee}`);
  if (nk !== key) bits.push(`number → ${label}`);
  await logSheet(who, 'Edited an order', `${cur.label || key}: ${bits.join(', ') || 'no change'}`);
}
export async function removeRows(ids, who = '') {
  await ensureSheet();
  const keys = [...new Set((Array.isArray(ids) ? ids : []).map(normNo).filter(Boolean))].slice(0, 5000);
  if (!keys.length) throw new HttpError(400, 'Choose at least one order.');
  await db()`DELETE FROM ship_sheet WHERE order_no = ANY(${keys})`;
  await logSheet(who, 'Deleted orders', keys.length === 1 ? keys[0] : `${keys.length} orders`);
  return keys.length;
}
/** Delete every order that came from one named sheet. */
export async function removeSource(name, who = '') {
  await ensureSheet();
  const n = String(name ?? '').trim();
  const [{ c }] = await db()`SELECT COUNT(*)::int AS c FROM ship_sheet WHERE source = ${n}`;
  if (!c) throw new HttpError(404, 'That sheet has no orders left.');
  await db()`DELETE FROM ship_sheet WHERE source = ${n}`;
  await logSheet(who, 'Deleted a sheet', `"${n || 'Unnamed'}" · ${c} order${c === 1 ? '' : 's'}`);
  return c;
}
export async function renameSource(from, to, who = '') {
  await ensureSheet();
  const a = String(from ?? '').trim(), b = String(to ?? '').trim().slice(0, 80);
  if (!b) throw new HttpError(400, 'Type a name for the sheet.');
  await db()`UPDATE ship_sheet SET source = ${b} WHERE source = ${a}`;
  await logSheet(who, 'Renamed a sheet', `"${a || 'Unnamed'}" → "${b}"`);
}
export async function logSheet(who, action, detail) {
  try { await db()`INSERT INTO ship_sheet_log (id, at, who, action, detail) VALUES (${'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)}, ${Date.now()}, ${who || ''}, ${action}, ${detail || ''})`; } catch (e) { /* the log is an extra */ }
}
export async function sheetLog(limit = 15) {
  await ensureSheet();
  return (await db()`SELECT at, who, action, detail FROM ship_sheet_log ORDER BY at DESC LIMIT ${limit}`).map((r) => ({ at: Number(r.at), who: r.who, action: r.action, detail: r.detail }));
}

const localDay = (ms, tz) => { try { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: tz }); } catch (e) { return new Date(Number(ms)).toISOString().slice(0, 10); } };

/** Every sheet row matched with its Shopify order. unit(row) = cost per unit from Odoo (or null). */
export async function loadSheet(tz, unit) {
  await ensureSheet();
  const rows = await db()`SELECT s.order_no, s.label, s.status, s.fee, s.updated_at, s.updated_by, s.source, o.name, o.created_at, o.items
    FROM ship_sheet s LEFT JOIN shop_orders o ON regexp_replace(lower(o.name), '[^0-9a-z]', '', 'g') = s.order_no ORDER BY s.updated_at DESC, s.order_no`;
  const list = rows.map((r) => {
    const kind = kindOf(r.status), matched = r.created_at !== null && r.created_at !== undefined, items = r.items || [];
    const rev = matched ? items.reduce((a, i) => a + (Number(i.q) || 0) * (Number(i.p) || 0), 0) : 0;
    let cost = 0;
    if (matched && unit) for (const i of items) { const u = unit({ product_variant_sku: i.s, product_title: i.t }); if (u !== null && u !== undefined) cost += u * (Number(i.q) || 0); }
    return { no: r.order_no, updatedAt: Number(r.updated_at) || 0, by: r.updated_by || '', src: r.source || '', label: r.label || r.name || r.order_no, status: r.status, kind, fee: Number(r.fee) || 0, matched, date: matched ? localDay(r.created_at, tz) : null, rev, cost };
  });
  const range = (a, b) => {
    const t = { fee: 0, rev: 0, cost: 0, returned: 0, delivered: 0, list: [] };
    for (const x of list) {
      if (!x.matched || x.kind === 'other' || x.date < a || x.date > b) continue;
      t.fee += x.fee; t.list.push(x);
      if (x.kind === 'returned') { t.returned++; t.rev += x.rev; t.cost += x.cost; } else t.delivered++;
    }
    return t;
  };
  const byMonth = () => {
    const m = new Map();
    for (const x of list) {
      if (!x.matched || x.kind === 'other') continue;
      const k = x.date.slice(0, 7), g = m.get(k) || { fee: 0, rev: 0, cost: 0 };
      g.fee += x.fee; if (x.kind === 'returned') { g.rev += x.rev; g.cost += x.cost; } m.set(k, g);
    }
    return m;
  };
  return { list, range, byMonth };
}
