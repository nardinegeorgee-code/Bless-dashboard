import { db, HttpError } from './_lib.js';

/* The courier sheet: column A order number, column B status, column E shipping fee.
 *  "returned to shipper confirmed" -> the order is taken out of revenue and cost, and its shipping fee is deducted from profit.
 *  "confirmed delivery"            -> the order stays, and its shipping fee is deducted from profit. */
let ready;
export function ensureSheet() {
  if (!ready) {
    ready = db()`CREATE TABLE IF NOT EXISTS ship_sheet (order_no TEXT PRIMARY KEY, label TEXT, status TEXT NOT NULL DEFAULT '', fee NUMERIC NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)`;
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export const normNo = (v) => String(v ?? '').toLowerCase().replace(/[^0-9a-z]/g, '');
export function kindOf(status) {
  const s = String(status || '').toLowerCase();
  if (/return/.test(s) && /shipper|sender|merchant/.test(s)) return 'returned';
  if (/confirmed\s+delivery|delivery\s+confirmed/.test(s)) return 'delivered';
  return 'other';
}
const money = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

/** rows: [[A, B, C, D, E], ...] exactly as in the sheet. A header row (no digits in column A) is skipped. */
export async function saveSheet(rows) {
  await ensureSheet();
  const out = new Map();
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 20000)) {
    const label = String(r?.[0] ?? '').trim(), no = normNo(label);
    if (!no || !/\d/.test(label)) continue;
    out.set(no, { no, label: label.slice(0, 40), status: String(r?.[1] ?? '').trim().slice(0, 120), fee: Math.max(0, money(r?.[4])) });
  }
  if (!out.size) throw new HttpError(400, 'No orders found. Column A must hold the order number, column B the status and column E the shipping fee.');
  const q = db(), now = Date.now();
  for (const x of out.values()) {
    await q`INSERT INTO ship_sheet (order_no, label, status, fee, updated_at) VALUES (${x.no}, ${x.label}, ${x.status}, ${x.fee}, ${now})
      ON CONFLICT (order_no) DO UPDATE SET label = EXCLUDED.label, status = EXCLUDED.status, fee = EXCLUDED.fee, updated_at = EXCLUDED.updated_at`;
  }
  return out.size;
}
export async function clearSheet() { await ensureSheet(); await db()`DELETE FROM ship_sheet`; }

const localDay = (ms, tz) => { try { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: tz }); } catch (e) { return new Date(Number(ms)).toISOString().slice(0, 10); } };

/** Every sheet row matched with its Shopify order. unit(row) = cost per unit from Odoo (or null). */
export async function loadSheet(tz, unit) {
  await ensureSheet();
  const rows = await db()`SELECT s.order_no, s.label, s.status, s.fee, o.name, o.created_at, o.items
    FROM ship_sheet s LEFT JOIN shop_orders o ON regexp_replace(lower(o.name), '[^0-9a-z]', '', 'g') = s.order_no ORDER BY s.updated_at DESC, s.order_no`;
  const list = rows.map((r) => {
    const kind = kindOf(r.status), matched = r.created_at !== null && r.created_at !== undefined, items = r.items || [];
    const rev = matched ? items.reduce((a, i) => a + (Number(i.q) || 0) * (Number(i.p) || 0), 0) : 0;
    let cost = 0;
    if (matched && unit) for (const i of items) { const u = unit({ product_variant_sku: i.s, product_title: i.t }); if (u !== null && u !== undefined) cost += u * (Number(i.q) || 0); }
    return { no: r.order_no, label: r.label || r.name || r.order_no, status: r.status, kind, fee: Number(r.fee) || 0, matched, date: matched ? localDay(r.created_at, tz) : null, rev, cost };
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
