// Inventory & stock management. Served through /api/data?st=... (all 12 Vercel functions are used).
//
// NOT LIVE BY DEFAULT: until the Super Admin presses "Make live", only the Super Admin can open it (preview),
// nothing here touches quotations, invoices or Odoo, and Odoo stays the source of stock.
//
// Model
// - stock_locations: storage places (several allowed). Every location has two buckets: sellable and damaged.
// - stock_balances: quantity per product (item_key 'o<odoo id>'), location and bucket.
// - stock_moves: the ledger. Append-only (a database trigger refuses UPDATE and DELETE). Every change to a balance
//   is written here in the same statement as the balance change, with balance before and after.
// - stock_docs: receipts, counts, returns, adjustments and transfers, with approval where needed.
// Stock for invoices: open invoices (Ready / Preparing) RESERVE stock; it leaves on-hand when the warehouse marks
// the invoice Transferred (only when live).

import { db, HttpError, requireUser, rid } from './_lib.js';
import { odooConfig, call, fieldsOf } from './_odoo.js';
import { productList } from './_quotes.js';

export const BUCKETS = ['sellable', 'damaged'];
export const MOVE_TYPES = ['OPENING', 'IN', 'OUT', 'RETURN', 'ADJUSTMENT', 'COUNT', 'TRANSFER'];
export const ADJ_REASONS = { sample: 'Samples', marketing: 'Marketing / giveaway', internal: 'Internal use', writeoff: 'Write-off', found: 'Found stock', correction: 'Correction', other: 'Other' };
export const RET_COND = { restock: 'Restockable (good condition)', damaged: 'Damaged', expired: 'Expired', quarantine: 'Quarantine' };
const KIND_PREFIX = { receipt: 'REC', count: 'CNT', return: 'RET', adjust: 'ADJ', transfer: 'TRF' };

let ready;
export function ensureStock() {
  if (!ready) {
    const q = db();
    ready = (async () => {
      await q`CREATE TABLE IF NOT EXISTS stock_settings (k TEXT PRIMARY KEY, v JSONB NOT NULL)`;
      await q`CREATE TABLE IF NOT EXISTS stock_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at BIGINT NOT NULL)`;
      await q`CREATE TABLE IF NOT EXISTS stock_items (item_key TEXT PRIMARY KEY, pid INT, name TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', barcode TEXT NOT NULL DEFAULT '', min_qty NUMERIC, updated_at BIGINT NOT NULL DEFAULT 0)`;
      await q`CREATE TABLE IF NOT EXISTS stock_balances (item_key TEXT NOT NULL, location_id TEXT NOT NULL, bucket TEXT NOT NULL, qty NUMERIC NOT NULL DEFAULT 0, PRIMARY KEY (item_key, location_id, bucket))`;
      await q`CREATE TABLE IF NOT EXISTS stock_moves (
        id BIGSERIAL PRIMARY KEY, at BIGINT NOT NULL, item_key TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', barcode TEXT NOT NULL DEFAULT '',
        location_id TEXT NOT NULL, location_name TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL, type TEXT NOT NULL, qty NUMERIC NOT NULL, before NUMERIC NOT NULL, after NUMERIC NOT NULL,
        ref_type TEXT NOT NULL DEFAULT '', ref_id TEXT NOT NULL DEFAULT '', ref_no TEXT NOT NULL DEFAULT '', by_id TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '', lot TEXT NOT NULL DEFAULT '', expiry TEXT NOT NULL DEFAULT '')`;
      await q`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS box_qty NUMERIC`;
      await q`CREATE INDEX IF NOT EXISTS stock_moves_item_idx ON stock_moves (item_key, at)`;
      await q`CREATE INDEX IF NOT EXISTS stock_moves_at_idx ON stock_moves (at)`;
      // the ledger can only grow: refuse any UPDATE or DELETE
      await q`CREATE OR REPLACE FUNCTION stock_moves_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'The stock ledger cannot be changed or deleted'; END $$ LANGUAGE plpgsql`;
      await q`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_moves_lock') THEN CREATE TRIGGER stock_moves_lock BEFORE UPDATE OR DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION stock_moves_append_only(); END IF; END $$`;
      await q`CREATE TABLE IF NOT EXISTS stock_docs (
        id TEXT PRIMARY KEY, no TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, location_id TEXT NOT NULL DEFAULT '', to_location_id TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL DEFAULT '',
        lines JSONB NOT NULL DEFAULT '[]', meta JSONB NOT NULL DEFAULT '{}', decision JSONB NOT NULL DEFAULT '{}', history JSONB NOT NULL DEFAULT '[]', posted_at BIGINT)`;
      await q`CREATE INDEX IF NOT EXISTS stock_docs_kind_idx ON stock_docs (kind, status)`;
      await q`CREATE SEQUENCE IF NOT EXISTS stock_receipt_seq`; await q`CREATE SEQUENCE IF NOT EXISTS stock_count_seq`; await q`CREATE SEQUENCE IF NOT EXISTS stock_return_seq`;
      await q`CREATE SEQUENCE IF NOT EXISTS stock_adjust_seq`; await q`CREATE SEQUENCE IF NOT EXISTS stock_transfer_seq`;
      await q`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stock_moved BOOLEAN NOT NULL DEFAULT false`.catch(() => {});
      await q`INSERT INTO stock_locations (id, name, active, created_at) VALUES ('main', 'Main warehouse', true, ${Date.now()}) ON CONFLICT (id) DO NOTHING`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export async function stockSettings(q) {
  const rows = await q`SELECT k, v FROM stock_settings`;
  const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  return { live: m.live === true, liveSince: Number(m.liveSince) || 0, dispatchLoc: typeof m.dispatchLoc === 'string' ? m.dispatchLoc : 'main' };
}
async function setSetting(q, k, v) { await q`INSERT INTO stock_settings (k, v) VALUES (${k}, ${JSON.stringify(v)}::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; }

// ---------- who may do what
const R = (u) => u.role;
const canView = (u) => ['super_admin', 'ceo', 'finance', 'warehouse'].includes(R(u));
const canReceive = (u) => ['super_admin', 'warehouse'].includes(R(u));
const canCount = canReceive, canTransfer = canReceive;
const canReturn = (u) => ['super_admin', 'warehouse', 'finance'].includes(R(u));
const canAdjust = canReturn;
const canApprove = (u) => ['super_admin', 'finance'].includes(R(u));
const isSA = (u) => R(u) === 'super_admin';

// ---------- helpers
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r3 = (n) => Math.round(n * 1000) / 1000;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const J = (v, d) => (v == null ? d : v);
const ev = (u, action, note = '') => ({ at: Date.now(), by: u.id, byName: u.username, role: u.role, action, note: String(note || '').slice(0, 1000) });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function cleanLine(l, { allowZero = false, cond = false } = {}) {
  const pid = Number(l.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new HttpError(400, 'Every line needs a product from Odoo.');
  // quantities can be entered in units or in boxes (boxes x units per box); stock is always kept in units
  const box = l.mode === 'box';
  const boxes = box ? r3(num(l.boxes)) : 0, boxQty = box ? r3(num(l.boxQty)) : 0;
  if (box && !(boxQty > 0)) throw new HttpError(400, `Enter how many units are in one box of ${str(l.name, 80) || 'each product'}.`);
  if (box && !(boxes > 0)) throw new HttpError(400, `Enter the number of boxes for ${str(l.name, 80) || 'each product'}.`);
  const qty = box ? r3(boxes * boxQty) : r3(num(l.qty));
  if (allowZero ? qty < 0 : !(qty > 0)) throw new HttpError(400, `Enter a quantity for ${str(l.name, 80) || 'each product'}.`);
  const out = { key: 'o' + pid, pid, name: str(l.name, 200), code: str(l.code, 60), barcode: str(l.barcode, 40), qty, mode: box ? 'box' : 'unit', boxes, boxQty, lot: str(l.lot, 40), expiry: isDate(String(l.expiry || '')) ? l.expiry : '', reason: str(l.reason, 300) };
  if (cond) { out.cond = RET_COND[l.cond] ? l.cond : ''; if (!out.cond) throw new HttpError(400, `Choose the condition for ${out.name}.`); }
  return out;
}
function cleanLines(list, opts) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Add at least one product.');
  if (list.length > 500) throw new HttpError(400, 'Up to 500 lines at a time.');
  return list.map((l) => cleanLine(l, opts));
}
async function locations(q) { return q`SELECT id, name, active FROM stock_locations ORDER BY created_at`; }
async function locById(q, id) { const [l] = await q`SELECT * FROM stock_locations WHERE id = ${String(id || '')}`; if (!l) throw new HttpError(400, 'Choose a location.'); if (!l.active) throw new HttpError(400, `${l.name} is switched off.`); return l; }
async function balance(q, key, loc, bucket) { const [b] = await q`SELECT qty FROM stock_balances WHERE item_key = ${key} AND location_id = ${loc} AND bucket = ${bucket}`; return b ? Number(b.qty) : 0; }
async function nextNo(q, kind) {
  const seq = { receipt: 'stock_receipt_seq', count: 'stock_count_seq', return: 'stock_return_seq', adjust: 'stock_adjust_seq', transfer: 'stock_transfer_seq' }[kind];
  const [{ n }] = await q`SELECT nextval(${seq})::int AS n`;
  return `${KIND_PREFIX[kind]}-${String(n).padStart(4, '0')}`;
}
async function touchItems(q, lines) {
  for (const l of lines) await q`INSERT INTO stock_items (item_key, pid, name, code, barcode, box_qty, updated_at) VALUES (${l.key}, ${l.pid}, ${l.name}, ${l.code}, ${l.barcode}, ${l.boxQty > 0 ? l.boxQty : null}, ${Date.now()})
    ON CONFLICT (item_key) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, barcode = EXCLUDED.barcode, box_qty = COALESCE(EXCLUDED.box_qty, stock_items.box_qty), updated_at = EXCLUDED.updated_at`;
}

/** One ledger row and its balance change, in a single statement (so before/after are always right). */
function moveQ(q, m) {
  return q`WITH b AS (
      INSERT INTO stock_balances (item_key, location_id, bucket, qty) VALUES (${m.key}, ${m.loc}, ${m.bucket}, ${m.d})
      ON CONFLICT (item_key, location_id, bucket) DO UPDATE SET qty = stock_balances.qty + EXCLUDED.qty RETURNING qty)
    INSERT INTO stock_moves (at, item_key, name, code, barcode, location_id, location_name, bucket, type, qty, before, after, ref_type, ref_id, ref_no, by_id, by_name, reason, lot, expiry)
    SELECT ${m.at}, ${m.key}, ${m.name || ''}, ${m.code || ''}, ${m.barcode || ''}, ${m.loc}, ${m.locName || ''}, ${m.bucket}, ${m.type}, ${m.d}, b.qty - ${m.d}, b.qty,
      ${m.refType || ''}, ${m.refId || ''}, ${m.refNo || ''}, ${m.by || ''}, ${m.byName || ''}, ${m.reason || ''}, ${m.lot || ''}, ${m.expiry || ''} FROM b`;
}
const packNote = (l) => (l.mode === 'box' && l.boxes ? `${r3(l.boxes)} ${l.boxes === 1 ? 'box' : 'boxes'} of ${r3(l.boxQty)}` : '');
const mv = (l, extra) => { const m = { key: l.key, name: l.name, code: l.code, barcode: l.barcode, lot: l.lot, expiry: l.expiry, ...extra }; const p = packNote(l); if (p && Math.abs(Math.abs(m.d) - l.qty) < 1e-9) m.reason = [m.reason, p].filter(Boolean).join(' · '); return m; };

/** Check there is enough before taking stock out (sums lines that hit the same product). */
async function needStock(q, lines, loc, bucket, locName) {
  const want = new Map();
  for (const l of lines) want.set(l.key, (want.get(l.key) || 0) + l.qty);
  for (const [key, w] of want) {
    const have = await balance(q, key, loc, bucket);
    if (have < w - 1e-9) { const l = lines.find((x) => x.key === key); throw new HttpError(409, `Not enough ${l.name} in ${locName} (${bucket}): ${have} there, ${w} needed.`); }
  }
}

/** Claim a document, post its moves and mark it posted, all-or-nothing. */
async function post(q, doc, fromStatus, moves, u, action) {
  const now = Date.now();
  const claim = await q`UPDATE stock_docs SET status = 'posting', updated_at = ${now} WHERE id = ${doc.id} AND status = ${fromStatus} RETURNING id`;
  if (!claim.length) throw new HttpError(409, 'Someone changed this document at the same moment. Reload and try again.');
  const hist = [...J(doc.history, []), ev(u, action)].slice(-100);
  try {
    await q.transaction([
      ...moves.map((m) => moveQ(q, { at: now, refType: doc.kind, refId: doc.id, refNo: doc.no, by: u.id, byName: u.username, ...m })),
      q`UPDATE stock_docs SET status = 'posted', posted_at = ${now}, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${doc.id}`,
    ]);
  } catch (e) {
    await q`UPDATE stock_docs SET status = ${fromStatus} WHERE id = ${doc.id} AND status = 'posting'`;
    throw e;
  }
}

function docOut(r, u) {
  const lines = J(r.lines, []);
  return {
    id: r.id, no: r.no, kind: r.kind, status: r.status, loc: r.location_id, toLoc: r.to_location_id, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    createdBy: r.created_by, createdByName: r.created_by_name, lines, meta: J(r.meta, {}), decision: J(r.decision, {}), history: J(r.history, []), postedAt: r.posted_at ? Number(r.posted_at) : 0,
    units: r3(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)),
    can: {
      approve: r.status === 'pending' && canApprove(u),
      edit: r.kind === 'count' && r.status === 'draft' && canCount(u),
      cancel: ['draft', 'pending'].includes(r.status) && (r.created_by === u.id || isSA(u)),
    },
  };
}

// reserved = items on open (not yet transferred) invoices
async function reservedMap(q, set) {
  const m = new Map();
  let rows = [];
  try { rows = set.live ? await q`SELECT lines FROM invoices WHERE wh_status IN ('ready', 'preparing') AND NOT example AND created_at >= ${set.liveSince}` : await q`SELECT lines FROM invoices WHERE wh_status IN ('ready', 'preparing') AND NOT example`; } catch (e) { rows = []; }
  for (const r of rows) for (const l of J(r.lines, [])) if (l.pid) m.set('o' + l.pid, (m.get('o' + l.pid) || 0) + (Number(l.qty) || 0));
  return m;
}

/** Is the module live? (for the menu) */
export async function stockLive() { try { await ensureStock(); return (await stockSettings(db())).live; } catch (e) { return false; } }

/** Availability per Odoo product id, for the quotation builder (only when live). */
export async function stockAvailability() {
  try {
    await ensureStock();
    const q = db(), set = await stockSettings(q);
    if (!set.live) return null;
    const [bal, res] = await Promise.all([q`SELECT item_key, SUM(qty) AS q FROM stock_balances WHERE bucket = 'sellable' GROUP BY item_key`, reservedMap(q, set)]);
    const out = {};
    for (const b of bal) out[b.item_key.slice(1)] = Number(b.q);
    for (const [k, v] of res) { const id = k.slice(1); out[id] = (out[id] || 0) - v; }
    return out;
  } catch (e) { return null; }
}

/** Called when the warehouse marks an invoice Transferred (or undoes it). Only acts when live. */
export async function stockOnDispatch(inv, u, done) {
  await ensureStock();
  const q = db(), set = await stockSettings(q);
  if (!set.live || inv.example || Number(inv.created_at) < set.liveSince) return;
  if (done === !!inv.stock_moved) return;
  const [loc] = await q`SELECT * FROM stock_locations WHERE id = ${set.dispatchLoc}`;
  const L = loc || { id: 'main', name: 'Main warehouse' };
  const lines = J(inv.lines, []).filter((l) => l.pid && Number(l.qty) > 0).map((l) => ({ key: 'o' + l.pid, pid: l.pid, name: l.name, code: l.code || '', barcode: l.barcode || '', qty: Number(l.qty), lot: '', expiry: '' }));
  await touchItems(q, lines);
  const now = Date.now();
  await q.transaction([
    ...lines.map((l) => moveQ(q, mv(l, { at: now, loc: L.id, locName: L.name, bucket: 'sellable', type: 'OUT', d: done ? -l.qty : l.qty, refType: 'invoice', refId: inv.id, refNo: inv.no, by: u.id, byName: u.username, reason: done ? 'Transferred to distributor' : 'Transfer undone' }))),
    q`UPDATE invoices SET stock_moved = ${done} WHERE id = ${inv.id}`,
  ]);
}

/** Odoo product packaging (boxes): sizes by product, or the product behind a box barcode. Optional: missing model is fine. */
async function packagings(want) {
  const out = { byPid: new Map(), hit: null };
  if (!want) return out;
  const cfg = odooConfig();
  if (cfg.missing.length) return out;
  const dom = want.barcode ? [['barcode', '=', want.barcode]] : [['product_id', 'in', want.pids]];
  const rows = await call(cfg, 'product.packaging', 'search_read', [dom], { fields: ['product_id', 'qty', 'barcode', 'name'], limit: 300 });
  for (const r of rows) {
    const pid = Array.isArray(r.product_id) ? r.product_id[0] : r.product_id, qty = Number(r.qty) || 0;
    if (!pid || !(qty > 0)) continue;
    if (!out.byPid.has(pid) || qty > out.byPid.get(pid)) out.byPid.set(pid, qty);
    if (want.barcode && !out.hit) out.hit = { pid, qty };
  }
  return out;
}

async function odooStock() {
  const cfg = odooConfig();
  if (cfg.missing.length) throw new HttpError(400, 'Odoo is not connected.');
  const have = await fieldsOf(cfg, 'product.product');
  const f = ['display_name', 'default_code', 'barcode', 'qty_available', ...(have.has('is_storable') ? ['is_storable'] : []), ...(have.has('type') ? ['type'] : [])];
  const rows = await call(cfg, 'product.product', 'search_read', [[['active', '=', true]]], { fields: f, limit: 8000 });
  return rows.filter((p) => (have.has('is_storable') ? p.is_storable : p.type === 'product')).map((p) => ({ pid: p.id, name: String(p.display_name || '').replace(/^\[[^\]]*\]\s*/, ''), code: p.default_code || '', barcode: p.barcode || '', qty: Number(p.qty_available) || 0 }));
}

// =====================================================================
export async function stockApi(req, res) {
  const u = await requireUser(req);
  await ensureStock();
  const q = db();
  const set = await stockSettings(q);
  if (!set.live && !isSA(u)) throw new HttpError(403, 'The stock module is not live yet.');
  if (!canView(u)) throw new HttpError(403, 'You do not have access to stock.');
  const k = String(req.query.st || '');
  const body = req.body || {};

  if (req.method === 'GET') {
    if (k === 'home') {
      const [locs, bal, items, res2, pending] = await Promise.all([locations(q), q`SELECT item_key, location_id, bucket, qty FROM stock_balances`, q`SELECT * FROM stock_items`, reservedMap(q, set), q`SELECT * FROM stock_docs WHERE status = 'pending' ORDER BY created_at`]);
      let plist = [];
      try { plist = (await productList()).list; } catch (e) { plist = []; }
      const map = new Map();
      const add = (key) => { if (!map.has(key)) map.set(key, { key, pid: Number(key.slice(1)), name: '', code: '', barcode: '', min: null, loc: {}, damaged: {}, onHand: 0, dmg: 0, reserved: 0 }); return map.get(key); };
      for (const p of plist) Object.assign(add('o' + p.pid), { name: p.name, code: p.code, barcode: p.barcode });
      for (const it of items) { const r = add(it.item_key); r.name = r.name || it.name; r.code = r.code || it.code; r.barcode = r.barcode || it.barcode; r.min = it.min_qty == null ? null : Number(it.min_qty); }
      for (const b of bal) { const r = add(b.item_key), v = Number(b.qty); if (b.bucket === 'sellable') { r.loc[b.location_id] = v; r.onHand += v; } else { r.damaged[b.location_id] = v; r.dmg += v; } }
      for (const [key, v] of res2) add(key).reserved = v;
      const rows = [...map.values()].map((r) => ({ ...r, onHand: r3(r.onHand), dmg: r3(r.dmg), reserved: r3(r.reserved), available: r3(r.onHand - r.reserved) }));
      return res.json({ settings: set, locations: locs, rows, pending: pending.map((d) => docOut(d, u)), me: { role: u.role, receive: canReceive(u), count: canCount(u), ret: canReturn(u), adjust: canAdjust(u), transfer: canTransfer(u), approve: canApprove(u), admin: isSA(u) }, reasons: ADJ_REASONS, conds: RET_COND });
    }
    if (k === 'docs') {
      const kind = String(req.query.kind || '');
      const rows = kind ? await q`SELECT * FROM stock_docs WHERE kind = ${kind} ORDER BY created_at DESC LIMIT 300` : await q`SELECT * FROM stock_docs ORDER BY created_at DESC LIMIT 300`;
      return res.json({ docs: rows.map((d) => docOut(d, u)) });
    }
    if (k === 'doc') {
      const [d] = await q`SELECT * FROM stock_docs WHERE id = ${String(req.query.id || '')}`;
      if (!d) throw new HttpError(404, 'Document not found.');
      const out = docOut(d, u);
      if (d.kind === 'count' && d.status === 'draft') {
        // show the live system quantity while counting
        for (const l of out.lines) l.systemNow = await balance(q, l.key, d.location_id, 'sellable');
      }
      return res.json({ doc: out });
    }
    if (k === 'moves') {
      const key = String(req.query.key || ''), type = String(req.query.type || ''), loc = String(req.query.loc || '');
      const from = Number(req.query.from) || 0, to = Number(req.query.to) || 9e15;
      const rows = await q`SELECT * FROM stock_moves WHERE at >= ${from} AND at <= ${to}
        AND (${key} = '' OR item_key = ${key}) AND (${type} = '' OR type = ${type}) AND (${loc} = '' OR location_id = ${loc}) ORDER BY id DESC LIMIT 2000`;
      return res.json({ moves: rows.map((m) => ({ id: Number(m.id), at: Number(m.at), key: m.item_key, name: m.name, code: m.code, barcode: m.barcode, loc: m.location_id, locName: m.location_name, bucket: m.bucket, type: m.type, qty: Number(m.qty), before: Number(m.before), after: Number(m.after), refType: m.ref_type, refId: m.ref_id, refNo: m.ref_no, byName: m.by_name, reason: m.reason, lot: m.lot, expiry: m.expiry })) });
    }
    if (k === 'products') {
      const s = String(req.query.s || '').trim().toLowerCase(), loc = String(req.query.loc || '');
      let list = [];
      try { list = (await productList()).list; } catch (e) { list = []; }
      const exact = s ? list.filter((p) => p.barcode && p.barcode.toLowerCase() === s) : [];
      const words = s.split(/\s+/).filter(Boolean);
      const hits = (s ? list.filter((p) => !exact.includes(p) && words.every((w) => (p.name + ' ' + p.code + ' ' + p.barcode).toLowerCase().includes(w))) : list).slice(0, 30);
      // a box barcode (Odoo product packaging) means "one box of this product"
      let boxHit = null;
      const pk = await packagings(s && !exact.length ? { barcode: s } : null).catch(() => ({ byPid: new Map(), hit: null }));
      if (pk.hit) { const p = list.find((x) => x.pid === pk.hit.pid); if (p) boxHit = { ...p, boxScan: true, odooBox: pk.hit.qty }; }
      const out = (boxHit ? [boxHit] : [...exact, ...hits]).slice(0, 30).map((p) => ({ ...p }));
      const ids = out.map((p) => p.pid);
      const saved = ids.length ? new Map((await q`SELECT pid, box_qty FROM stock_items WHERE pid = ANY(${ids}::int[]) AND box_qty IS NOT NULL`).map((r) => [Number(r.pid), Number(r.box_qty)])) : new Map();
      const odooBoxes = ids.length ? (await packagings({ pids: ids }).catch(() => ({ byPid: new Map() }))).byPid : new Map();
      for (const p of out) {
        p.here = loc ? await balance(q, 'o' + p.pid, loc, 'sellable') : null;
        p.boxQty = p.odooBox || saved.get(p.pid) || odooBoxes.get(p.pid) || null;
      }
      return res.json({ products: out, exact: boxHit || exact.length === 1 ? out[0] : null, total: list.length });
    }
    if (k === 'invoices') {
      let rows = [];
      try { rows = await q`SELECT id, no, customer, lines, created_at FROM invoices WHERE NOT example ORDER BY created_at DESC LIMIT 200`; } catch (e) { rows = []; }
      return res.json({ invoices: rows.map((r) => ({ id: r.id, no: r.no, customer: J(r.customer, {}), lines: J(r.lines, []).map((l) => ({ pid: l.pid, name: l.name, code: l.code, barcode: l.barcode, qty: l.qty })), createdAt: Number(r.created_at) })) });
    }
    if (k === 'compare') {
      const od = await odooStock();
      const bal = await q`SELECT item_key, SUM(qty) AS q FROM stock_balances WHERE bucket = 'sellable' GROUP BY item_key`;
      const hub = new Map(bal.map((b) => [b.item_key, Number(b.q)]));
      return res.json({ rows: od.map((p) => ({ key: 'o' + p.pid, pid: p.pid, name: p.name, code: p.code, odoo: p.qty, hub: hub.has('o' + p.pid) ? hub.get('o' + p.pid) : null })) });
    }
    throw new HttpError(400, 'Unknown request.');
  }

  // ---------- changes
  const a = String(body.action || '');
  const now = Date.now();
  const loadDoc = async (id) => { const [d] = await q`SELECT * FROM stock_docs WHERE id = ${String(id || '')}`; if (!d) throw new HttpError(404, 'Document not found.'); return d; };
  const insertDoc = async (kind, status, loc, toLoc, lines, meta, action) => {
    const id = rid('s'), no = await nextNo(q, kind);
    await q`INSERT INTO stock_docs (id, no, kind, status, location_id, to_location_id, created_at, updated_at, created_by, created_by_name, lines, meta, history)
      VALUES (${id}, ${no}, ${kind}, ${status}, ${loc}, ${toLoc || ''}, ${now}, ${now}, ${u.id}, ${u.username}, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(meta)}::jsonb, ${JSON.stringify([ev(u, action)])}::jsonb)`;
    const [d] = await q`SELECT * FROM stock_docs WHERE id = ${id}`;
    return d;
  };
  const back = async (id) => { const [d] = await q`SELECT * FROM stock_docs WHERE id = ${id}`; return res.json({ doc: docOut(d, u) }); };

  // --- Stock-In (receipt): posted at once
  if (a === 'receipt') {
    if (!canReceive(u)) throw new HttpError(403, 'Only the warehouse team can receive stock.');
    const L = await locById(q, body.loc), lines = cleanLines(body.lines);
    const m = body.meta || {};
    const meta = { sourceType: ['supplier', 'production', 'other'].includes(m.sourceType) ? m.sourceType : 'supplier', source: str(m.source, 120), ref: str(m.ref, 80), date: isDate(String(m.date || '')) ? m.date : new Date(now).toISOString().slice(0, 10), notes: str(m.notes, 1000) };
    if (!meta.source) throw new HttpError(400, meta.sourceType === 'production' ? 'Write the production run or line.' : 'Write the supplier or source.');
    await touchItems(q, lines);
    const d = await insertDoc('receipt', 'ready', L.id, '', lines, meta, 'created');
    await post(q, d, 'ready', lines.map((l) => mv(l, { loc: L.id, locName: L.name, bucket: 'sellable', type: 'IN', d: l.qty, reason: [meta.sourceType === 'production' ? 'Production' : meta.sourceType === 'supplier' ? 'Supplier' : 'Received', meta.source, meta.ref].filter(Boolean).join(' · ') })), u, 'received into stock');
    return back(d.id);
  }

  // --- Transfer between locations: posted at once
  if (a === 'transfer') {
    if (!canTransfer(u)) throw new HttpError(403, 'Only the warehouse team can move stock between locations.');
    const A = await locById(q, body.loc), B = await locById(q, body.toLoc);
    if (A.id === B.id) throw new HttpError(400, 'Choose two different locations.');
    const lines = cleanLines(body.lines);
    await needStock(q, lines, A.id, 'sellable', A.name);
    await touchItems(q, lines);
    const d = await insertDoc('transfer', 'ready', A.id, B.id, lines, { notes: str(body.notes, 1000) }, 'created');
    await post(q, d, 'ready', lines.flatMap((l) => [mv(l, { loc: A.id, locName: A.name, bucket: 'sellable', type: 'TRANSFER', d: -l.qty, reason: `To ${B.name}` }), mv(l, { loc: B.id, locName: B.name, bucket: 'sellable', type: 'TRANSFER', d: l.qty, reason: `From ${A.name}` })]), u, `moved from ${A.name} to ${B.name}`);
    return back(d.id);
  }

  // --- Adjustment: needs approval
  if (a === 'adjust') {
    if (!canAdjust(u)) throw new HttpError(403, 'You cannot adjust stock.');
    const L = await locById(q, body.loc), lines = cleanLines(body.lines);
    const reason = ADJ_REASONS[body.reason] ? body.reason : '';
    if (!reason) throw new HttpError(400, 'Choose a reason.');
    const notes = str(body.notes, 1000);
    if (!notes) throw new HttpError(400, 'Write a short explanation for the adjustment.');
    const meta = { reason, direction: body.direction === 'add' ? 'add' : 'remove', bucket: BUCKETS.includes(body.bucket) ? body.bucket : 'sellable', notes };
    if (meta.direction === 'remove') await needStock(q, lines, L.id, meta.bucket, L.name);
    await touchItems(q, lines);
    const d = await insertDoc('adjust', 'pending', L.id, '', lines, meta, 'sent for approval');
    return back(d.id);
  }

  // --- Return: needs approval
  if (a === 'return') {
    if (!canReturn(u)) throw new HttpError(403, 'You cannot record returns.');
    const L = await locById(q, body.loc), lines = cleanLines(body.lines, { cond: true });
    const source = ['invoice', 'customer', 'internal'].includes(body.source) ? body.source : 'customer';
    if (source === 'internal' && lines.some((l) => l.cond === 'restock')) throw new HttpError(400, 'Internal damaged or expired stock cannot be "restockable": choose Damaged, Expired or Quarantine.');
    let inv = null;
    if (source === 'invoice') { const [i] = await q`SELECT id, no, customer FROM invoices WHERE id = ${String(body.invoiceId || '')}`; if (!i) throw new HttpError(400, 'Choose the invoice this return belongs to.'); inv = i; }
    const meta = { source, invoiceId: inv ? inv.id : '', invoiceNo: inv ? inv.no : '', customer: inv ? J(inv.customer, {}).name || '' : str(body.customer, 160), notes: str(body.notes, 1000) };
    if (source === 'customer' && !meta.customer) throw new HttpError(400, 'Write who returned the goods.');
    if (lines.some((l) => !l.reason) && !meta.notes) throw new HttpError(400, 'Write the reason for the return.');
    if (source === 'internal') await needStock(q, lines, L.id, 'sellable', L.name);
    await touchItems(q, lines);
    const d = await insertDoc('return', 'pending', L.id, '', lines, meta, 'sent for approval');
    return back(d.id);
  }

  // --- Stock count (stocktake)
  if (a === 'count-start') {
    if (!canCount(u)) throw new HttpError(403, 'Only the warehouse team can count stock.');
    const L = await locById(q, body.loc);
    let lines = [];
    if (body.scope === 'all') {
      const rows = await q`SELECT b.item_key, b.qty, i.pid, i.name, i.code, i.barcode FROM stock_balances b LEFT JOIN stock_items i ON i.item_key = b.item_key WHERE b.location_id = ${L.id} AND b.bucket = 'sellable' AND b.qty <> 0 ORDER BY i.name`;
      lines = rows.map((r) => ({ key: r.item_key, pid: r.pid || Number(r.item_key.slice(1)), name: r.name || '', code: r.code || '', barcode: r.barcode || '', counted: null, reason: '' }));
    }
    const d = await insertDoc('count', 'draft', L.id, '', lines, { notes: str(body.notes, 500), scope: body.scope === 'all' ? 'all' : 'scan' }, 'count started');
    return back(d.id);
  }
  if (a === 'count-save' || a === 'count-submit') {
    if (!canCount(u)) throw new HttpError(403, 'Only the warehouse team can count stock.');
    const d = await loadDoc(body.id);
    if (d.kind !== 'count' || d.status !== 'draft') throw new HttpError(409, 'This count can no longer be changed.');
    if (!Array.isArray(body.lines)) throw new HttpError(400, 'Missing lines.');
    const lines = body.lines.slice(0, 1500).map((l) => {
      const pid = Number(l.pid); if (!Number.isInteger(pid) || pid <= 0) throw new HttpError(400, 'Every line needs a product from Odoo.');
      const c = l.counted === null || l.counted === '' || l.counted === undefined ? null : r3(num(l.counted, NaN));
      if (c !== null && !(c >= 0)) throw new HttpError(400, `Counted quantity for ${str(l.name, 80)} must be 0 or more.`);
      return { key: 'o' + pid, pid, name: str(l.name, 200), code: str(l.code, 60), barcode: str(l.barcode, 40), counted: c, reason: str(l.reason, 300) };
    });
    let status = 'draft', action = 'count saved';
    if (a === 'count-submit') {
      const counted = lines.filter((l) => l.counted !== null);
      if (!counted.length) throw new HttpError(400, 'Enter at least one counted quantity.');
      for (const l of counted) { l.system = await balance(q, l.key, d.location_id, 'sellable'); l.variance = r3(l.counted - l.system); }
      const miss = counted.find((l) => l.variance !== 0 && !l.reason);
      if (miss) throw new HttpError(400, `Write the reason for the difference on ${miss.name} (${miss.variance > 0 ? '+' : ''}${miss.variance}).`);
      status = 'pending'; action = 'count sent for approval';
      for (const l of lines) if (l.counted === null) { l.skipped = true; }
    }
    await touchItems(q, lines.map((l) => ({ ...l })));
    const hist = [...J(d.history, []), ev(u, action)].slice(-100);
    await q`UPDATE stock_docs SET lines = ${JSON.stringify(lines)}::jsonb, status = ${status}, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${d.id} AND status = 'draft'`;
    return back(d.id);
  }

  // --- approvals
  if (a === 'approve' || a === 'reject') {
    if (!canApprove(u)) throw new HttpError(403, 'Only the Super Admin or Finance approve stock changes.');
    const d = await loadDoc(body.id);
    if (d.status !== 'pending') throw new HttpError(409, 'This is not waiting for approval.');
    const note = str(body.note, 1000);
    if (a === 'reject') {
      if (!note) throw new HttpError(400, 'Write the reason for rejecting.');
      const to = d.kind === 'count' ? 'draft' : 'rejected';
      const hist = [...J(d.history, []), ev(u, 'rejected', note)].slice(-100);
      await q`UPDATE stock_docs SET status = ${to}, decision = ${JSON.stringify({ state: 'rejected', by: u.id, byName: u.username, at: now, note })}::jsonb, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${d.id} AND status = 'pending'`;
      return back(d.id);
    }
    const L = await locById(q, d.location_id), lines = J(d.lines, []), meta = J(d.meta, {});
    let moves = [];
    if (d.kind === 'count') {
      moves = lines.filter((l) => !l.skipped && l.counted !== null && Number(l.variance)).map((l) => mv(l, { loc: L.id, locName: L.name, bucket: 'sellable', type: 'COUNT', d: Number(l.variance), reason: `Counted ${l.counted}, system ${l.system}${l.reason ? ' · ' + l.reason : ''}` }));
    } else if (d.kind === 'adjust') {
      if (meta.direction === 'remove') await needStock(q, lines, L.id, meta.bucket, L.name);
      moves = lines.map((l) => mv(l, { loc: L.id, locName: L.name, bucket: meta.bucket, type: 'ADJUSTMENT', d: meta.direction === 'add' ? l.qty : -l.qty, reason: `${ADJ_REASONS[meta.reason]} · ${meta.notes}${l.reason ? ' · ' + l.reason : ''}` }));
    } else if (d.kind === 'return') {
      if (meta.source === 'internal') await needStock(q, lines, L.id, 'sellable', L.name);
      moves = lines.flatMap((l) => {
        const why = `${RET_COND[l.cond]}${l.reason ? ' · ' + l.reason : ''}${meta.invoiceNo ? ' · invoice ' + meta.invoiceNo : meta.customer ? ' · ' + meta.customer : ''}`;
        if (meta.source === 'internal') return [mv(l, { loc: L.id, locName: L.name, bucket: 'sellable', type: 'RETURN', d: -l.qty, reason: `Moved to damaged · ${why}` }), mv(l, { loc: L.id, locName: L.name, bucket: 'damaged', type: 'RETURN', d: l.qty, reason: why })];
        return [mv(l, { loc: L.id, locName: L.name, bucket: l.cond === 'restock' ? 'sellable' : 'damaged', type: 'RETURN', d: l.qty, reason: why })];
      });
    } else throw new HttpError(400, 'Nothing to approve.');
    await q`UPDATE stock_docs SET decision = ${JSON.stringify({ state: 'approved', by: u.id, byName: u.username, at: now, note })}::jsonb WHERE id = ${d.id}`;
    await post(q, d, 'pending', moves, u, note ? `approved and applied · ${note}` : 'approved and applied');
    return back(d.id);
  }

  if (a === 'cancel') {
    const d = await loadDoc(body.id);
    if (!['draft', 'pending'].includes(d.status) || (d.created_by !== u.id && !isSA(u))) throw new HttpError(409, 'This cannot be cancelled.');
    const hist = [...J(d.history, []), ev(u, 'cancelled')].slice(-100);
    await q`UPDATE stock_docs SET status = 'cancelled', updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${d.id}`;
    return back(d.id);
  }

  // --- low-stock threshold per product
  if (a === 'min') {
    if (!isSA(u) && R(u) !== 'warehouse') throw new HttpError(403, 'Only the Super Admin or the warehouse team set minimums.');
    const l = cleanLine({ ...body, qty: 1 });
    const min = body.min === '' || body.min === null || body.min === undefined ? null : Math.max(0, num(body.min));
    await q`INSERT INTO stock_items (item_key, pid, name, code, barcode, min_qty, updated_at) VALUES (${l.key}, ${l.pid}, ${l.name}, ${l.code}, ${l.barcode}, ${min}, ${now})
      ON CONFLICT (item_key) DO UPDATE SET min_qty = EXCLUDED.min_qty, updated_at = EXCLUDED.updated_at`;
    return res.json({ ok: true });
  }

  // --- Super Admin settings
  if (!isSA(u)) throw new HttpError(403, 'Only the Super Admin can change stock settings.');
  if (a === 'location') {
    const name = str(body.name, 60);
    if (!name) throw new HttpError(400, 'Write the location name.');
    if (body.id) {
      if (body.active === false && body.id === set.dispatchLoc) throw new HttpError(400, 'This is the dispatch location: choose another dispatch location first.');
      await q`UPDATE stock_locations SET name = ${name}, active = ${body.active !== false} WHERE id = ${String(body.id)}`;
    } else await q`INSERT INTO stock_locations (id, name, active, created_at) VALUES (${rid('l')}, ${name}, true, ${now})`;
    return res.json({ locations: await locations(q) });
  }
  if (a === 'settings') {
    if (body.dispatchLoc) { await locById(q, body.dispatchLoc); await setSetting(q, 'dispatchLoc', String(body.dispatchLoc)); }
    if (typeof body.live === 'boolean' && body.live !== set.live) {
      if (body.live && body.confirm !== 'MAKE LIVE') throw new HttpError(400, 'Type MAKE LIVE to confirm.');
      await setSetting(q, 'live', body.live);
      if (body.live) await setSetting(q, 'liveSince', now);
    }
    return res.json({ settings: await stockSettings(q) });
  }
  if (a === 'import-odoo') {
    // opening balances from Odoo's on-hand quantities, only for products with no stock history yet
    const L = await locById(q, body.loc);
    const od = await odooStock();
    const seen = new Set((await q`SELECT DISTINCT item_key FROM stock_moves`).map((r) => r.item_key));
    const lines = od.filter((p) => !seen.has('o' + p.pid) && p.qty > 0).map((p) => ({ key: 'o' + p.pid, pid: p.pid, name: p.name, code: p.code, barcode: p.barcode, qty: r3(p.qty), lot: '', expiry: '' }));
    if (!lines.length) return res.json({ imported: 0, skipped: od.length });
    await touchItems(q, lines);
    for (let i = 0; i < lines.length; i += 200) {
      const part = lines.slice(i, i + 200);
      await q.transaction(part.map((l) => moveQ(q, mv(l, { at: now, loc: L.id, locName: L.name, bucket: 'sellable', type: 'OPENING', d: l.qty, refType: 'odoo', refNo: 'Odoo on-hand', by: u.id, byName: u.username, reason: 'Opening balance imported from Odoo' }))));
    }
    return res.json({ imported: lines.length, skipped: od.length - lines.length });
  }
  if (a === 'reset-preview') {
    if (set.live) throw new HttpError(409, 'The module is live: the ledger cannot be wiped.');
    if (body.confirm !== 'RESET') throw new HttpError(400, 'Type RESET to confirm.');
    await q`TRUNCATE stock_moves, stock_balances, stock_docs, stock_items RESTART IDENTITY`;
    await q`ALTER SEQUENCE stock_receipt_seq RESTART`; await q`ALTER SEQUENCE stock_count_seq RESTART`; await q`ALTER SEQUENCE stock_return_seq RESTART`; await q`ALTER SEQUENCE stock_adjust_seq RESTART`; await q`ALTER SEQUENCE stock_transfer_seq RESTART`;
    return res.json({ ok: true });
  }
  throw new HttpError(400, 'Unknown action.');
}
