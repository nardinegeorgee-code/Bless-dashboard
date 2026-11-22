// Quotations, approvals, invoices and the warehouse queue.
// Served through /api/data?q=... because the Vercel Hobby plan allows only 12 functions.
//
// Flow: Draft -> Pending approval (Finance, CEO and Super Admin approve in ANY order, all three needed)
//       -> Approved -> "Convert to invoice" button -> Invoice (Ready for Warehouse -> Preparing -> Transferred to Distributor).
// Any rejection sends the quote back to its creator (Rejected); editing it makes it a Draft again and
// submitting again resets all three approvals.
//
// Tax: each quote says whether its prices include or exclude VAT (default 14%).
// Validity: a submitted quote is valid for 3 days; after that it cannot be approved or converted.
// The Super Admin or the CEO can extend the date as an exception.
//
// Products and customers are read live from Odoo (read-only). Invoices live in the hub; nothing is written to Odoo.

import { db, HttpError, requireUser, rid } from './_lib.js';
import { odooConfig, call, fieldsOf, nm } from './_odoo.js';

export const SLOTS = ['finance', 'ceo', 'super_admin'];
export const SLOT_LABEL = { finance: 'Finance', ceo: 'CEO', super_admin: 'Super Admin' };
export const WH_STEPS = ['ready', 'preparing', 'transferred'];
export const VALID_DAYS = 3;
export const DEFAULT_TAX = { mode: 'excluded', rate: 14 };
const DAY = 864e5;

let ready;
export function ensureQuotes() {
  if (!ready) {
    const q = db();
    ready = (async () => {
      await q`CREATE SEQUENCE IF NOT EXISTS quote_no_seq`;
      await q`CREATE SEQUENCE IF NOT EXISTS invoice_no_seq`;
      await q`CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY, no TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        created_by TEXT NOT NULL, created_by_name TEXT NOT NULL DEFAULT '',
        customer JSONB NOT NULL DEFAULT '{}', lines JSONB NOT NULL DEFAULT '[]', discount JSONB NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '', subtotal NUMERIC NOT NULL DEFAULT 0, discount_total NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', approvals JSONB NOT NULL DEFAULT '{}',
        history JSONB NOT NULL DEFAULT '[]', invoice_id TEXT, submitted_at BIGINT)`;
      await q`CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, no TEXT NOT NULL, quote_id TEXT NOT NULL, quote_no TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL DEFAULT '',
        quote_by TEXT NOT NULL DEFAULT '', quote_by_name TEXT NOT NULL DEFAULT '',
        customer JSONB NOT NULL DEFAULT '{}', lines JSONB NOT NULL DEFAULT '[]', discount JSONB NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '', subtotal NUMERIC NOT NULL DEFAULT 0, discount_total NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT '', approvals JSONB NOT NULL DEFAULT '{}',
        wh_status TEXT NOT NULL DEFAULT 'ready', wh_history JSONB NOT NULL DEFAULT '[]')`;
      await q`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax JSONB NOT NULL DEFAULT '{}'`;
      await q`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until BIGINT`;
      await q`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax JSONB NOT NULL DEFAULT '{}'`;
      await q`CREATE INDEX IF NOT EXISTS quotes_status_idx ON quotes (status)`;
      await q`CREATE INDEX IF NOT EXISTS invoices_wh_idx ON invoices (wh_status)`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ---------- who may do what
const reportsOf = (u) => (Array.isArray(u.reports) ? u.reports : []);
export const canCreate = (u) => u.role === 'super_admin' || reportsOf(u).includes('quote');
export const slotOf = (u) => (SLOTS.includes(u.role) ? u.role : null);
export const seesAll = (u) => ['super_admin', 'ceo', 'finance'].includes(u.role);
export const isWarehouse = (u) => u.role === 'warehouse';
const canSeeQuote = (u, row) => seesAll(u) || row.created_by === u.id;
const canEditQuote = (u, row) => (row.created_by === u.id || u.role === 'super_admin') && ['draft', 'rejected'].includes(row.status);
const canConvert = (u, row) => row.created_by === u.id || seesAll(u);
const canExtend = (u) => u.role === 'super_admin' || u.role === 'ceo';
const isExpired = (r, now = Date.now()) => !!(['pending', 'approved'].includes(r.status) && r.valid_until && Number(r.valid_until) < now);
const canSeeInvoice = (u, row) => seesAll(u) || isWarehouse(u) || row.quote_by === u.id || row.created_by === u.id;
const canMoveWarehouse = (u) => isWarehouse(u) || u.role === 'super_admin';

// ---------- money: one place for every calculation, so discount rules can be added later
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (n) => Math.round(n * 100) / 100;
export function cleanDiscount(d) {
  const type = d && ['percent', 'amount'].includes(d.type) ? d.type : 'none';
  const value = type === 'none' ? 0 : Math.max(0, num(d.value));
  return { type, value: type === 'percent' ? Math.min(100, value) : value, rule: d && typeof d.rule === 'string' ? d.rule.slice(0, 40) : '' };
}
/** EXTENSION POINT for discount rules. Today: manual percent or fixed amount.
 *  Later rules (distributor tier, quantity breaks, promotions) can be added here using ctx
 *  ({ line, quote, customer }) and recorded in d.rule, without changing the stored data shape. */
export function discountAmount(base, d /* , ctx */) {
  if (!d || d.type === 'none') return 0;
  if (d.type === 'percent') return r2(base * Math.min(100, d.value) / 100);
  if (d.type === 'amount') return r2(Math.min(base, d.value));
  return 0;
}
export function cleanTax(t) {
  const mode = t && t.mode === 'included' ? 'included' : 'excluded';
  const rate = t && t.rate !== undefined && t.rate !== '' && Number.isFinite(Number(t.rate)) ? Math.min(100, Math.max(0, Number(t.rate))) : DEFAULT_TAX.rate;
  return { mode, rate };
}
export function priceQuote(lines, orderDiscount, taxIn) {
  const out = lines.map((l) => {
    const base = r2(l.price * l.qty), disc = discountAmount(base, l.discount, { line: l });
    return { ...l, base, disc, net: r2(base - disc) };
  });
  const subtotal = r2(out.reduce((a, l) => a + l.net, 0));
  const lineDisc = r2(out.reduce((a, l) => a + l.disc, 0));
  const orderDisc = discountAmount(subtotal, orderDiscount, { quote: true });
  const amount = r2(subtotal - orderDisc), tax = cleanTax(taxIn);
  // excluded: prices are before VAT, VAT is added on top. included: prices already contain VAT, which is shown inside.
  const untaxed = tax.mode === 'excluded' ? amount : r2(amount / (1 + tax.rate / 100));
  const taxAmount = tax.mode === 'excluded' ? r2(amount * tax.rate / 100) : r2(amount - untaxed);
  const total = tax.mode === 'excluded' ? r2(amount + taxAmount) : amount;
  return { lines: out, gross: r2(out.reduce((a, l) => a + l.base, 0)), lineDisc, subtotal, orderDisc, discountTotal: r2(lineDisc + orderDisc), afterDiscount: amount, taxMode: tax.mode, taxRate: tax.rate, untaxed, tax: taxAmount, total };
}
const str = (v, n) => String(v ?? '').trim().slice(0, n);
function cleanLines(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Items must be a list.');
  if (list.length > 300) throw new HttpError(400, 'A quotation can have up to 300 items.');
  return list.map((l) => {
    const name = str(l.name, 200);
    if (!name) throw new HttpError(400, 'Every item needs a product name.');
    const qty = Math.min(1e6, Math.max(0, num(l.qty)));
    if (!(qty > 0)) throw new HttpError(400, `Enter a quantity for ${name}.`);
    const pid = Number.isInteger(Number(l.pid)) && Number(l.pid) > 0 ? Number(l.pid) : null;
    return { pid, name, code: str(l.code, 60), barcode: str(l.barcode, 40), listPrice: l.listPrice == null || l.listPrice === '' ? null : Math.max(0, num(l.listPrice)), price: Math.max(0, num(l.price)), qty, discount: cleanDiscount(l.discount) };
  });
}
function cleanCustomer(c) {
  const name = str(c && c.name, 160);
  if (!name) throw new HttpError(400, 'Choose a customer or distributor.');
  const id = Number.isInteger(Number(c.id)) && Number(c.id) > 0 ? Number(c.id) : null;
  return { id, name, city: str(c.city, 80), phone: str(c.phone, 40) };
}
const blankApprovals = () => Object.fromEntries(SLOTS.map((s) => [s, { state: 'pending', by: '', byName: '', at: 0, note: '' }]));
const ev = (u, action, note = '') => ({ at: Date.now(), by: u.id, byName: u.username, role: u.role, action, note: String(note || '').slice(0, 1000) });

// ---------- shaping rows for the browser
const J = (v, d) => (v == null ? d : v);
function quoteOut(r, u) {
  const priced = priceQuote(J(r.lines, []), J(r.discount, {}), J(r.tax, {}));
  const ap = J(r.approvals, {}), expired = isExpired(r);
  return {
    id: r.id, no: r.no, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), submittedAt: r.submitted_at ? Number(r.submitted_at) : 0,
    createdBy: r.created_by, createdByName: r.created_by_name, customer: J(r.customer, {}), lines: priced.lines, discount: cleanDiscount(J(r.discount, {})),
    notes: r.notes, tax: cleanTax(J(r.tax, {})), totals: priced, currency: r.currency, status: r.status, expired, validUntil: r.valid_until ? Number(r.valid_until) : 0, approvals: ap, history: J(r.history, []), invoiceId: r.invoice_id || null,
    can: u ? { edit: canEditQuote(u, r), convert: r.status === 'approved' && !expired && canConvert(u, r), approve: r.status === 'pending' && !expired && !!slotOf(u) && ap[slotOf(u)] && ap[slotOf(u)].state === 'pending', withdraw: (r.status === 'pending' || (r.status === 'approved' && expired)) && (r.created_by === u.id || u.role === 'super_admin'), extend: ['pending', 'approved'].includes(r.status) && canExtend(u), del: canEditQuote(u, r) && r.status === 'draft' } : {},
  };
}
function quoteSummary(r, u) {
  const o = quoteOut(r, u);
  return { id: o.id, no: o.no, createdAt: o.createdAt, updatedAt: o.updatedAt, createdBy: o.createdBy, createdByName: o.createdByName, customer: o.customer, items: o.lines.length, units: o.lines.reduce((a, l) => a + l.qty, 0), total: o.totals.total, taxMode: o.tax.mode, currency: o.currency, status: o.status, expired: o.expired, validUntil: o.validUntil, approvals: o.approvals, invoiceId: o.invoiceId, priceChanged: o.lines.some((l) => l.listPrice != null && Math.abs(l.listPrice - l.price) > 0.004), can: o.can };
}
function invoiceOut(r, u) {
  const hideMoney = u && isWarehouse(u);
  const priced = priceQuote(J(r.lines, []), J(r.discount, {}), J(r.tax, {}));
  const lines = priced.lines.map((l) => (hideMoney ? { pid: l.pid, name: l.name, code: l.code, barcode: l.barcode, qty: l.qty } : l));
  return {
    id: r.id, no: r.no, quoteId: r.quote_id, quoteNo: r.quote_no, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), createdByName: r.created_by_name, quoteByName: r.quote_by_name,
    customer: J(r.customer, {}), lines, items: lines.length, units: lines.reduce((a, l) => a + l.qty, 0), totals: hideMoney ? null : priced, currency: r.currency, notes: r.notes,
    approvals: J(r.approvals, {}), whStatus: r.wh_status, whHistory: J(r.wh_history, []), can: { move: !!u && canMoveWarehouse(u) },
  };
}

// ---------- Odoo look-ups (cached a few minutes per server instance)
let prodCache = { at: 0, list: [], currency: '' };
async function products() {
  if (Date.now() - prodCache.at < 5 * 60 * 1000 && prodCache.list.length) return prodCache;
  const cfg = odooConfig();
  if (cfg.missing.length) return { at: 0, list: [], currency: '' };
  const have = await fieldsOf(cfg, 'product.product');
  const dom = [['active', '=', true]]; if (have.has('sale_ok')) dom.push(['sale_ok', '=', true]);
  const rows = await call(cfg, 'product.product', 'search_read', [dom], { fields: ['display_name', 'default_code', 'barcode', 'list_price'], limit: 6000 });
  let currency = '';
  try { const c = await call(cfg, 'res.company', 'search_read', [[]], { fields: ['currency_id'], limit: 1 }); currency = String(nm(c[0]?.currency_id)).slice(0, 3); } catch (e) { /* no currency */ }
  const list = rows.map((p) => ({ pid: p.id, name: String(p.display_name || '').replace(/^\[[^\]]*\]\s*/, ''), code: p.default_code || '', barcode: p.barcode || '', price: Number(p.list_price) || 0 }));
  prodCache = { at: Date.now(), list, currency };
  return prodCache;
}
async function customers(s) {
  const cfg = odooConfig();
  if (cfg.missing.length) return [];
  const have = await fieldsOf(cfg, 'res.partner');
  const dom = [['active', '=', true]];
  if (s) dom.push('|', '|', ['name', 'ilike', s], ['city', 'ilike', s], ['phone', 'ilike', s]);
  const order = have.has('customer_rank') ? 'customer_rank desc, name asc' : 'name asc';
  const rows = await call(cfg, 'res.partner', 'search_read', [dom], { fields: ['name', 'city', 'phone', 'is_company', ...(have.has('customer_rank') ? ['customer_rank'] : [])], limit: 25, order });
  return rows.map((p) => ({ id: p.id, name: p.name || '', city: p.city || '', phone: p.phone || '', company: !!p.is_company }));
}

// ---------- the API
export async function quotesApi(req, res) {
  const u = await requireUser(req);
  await ensureQuotes();
  const q = db();
  const k = String(req.query.q || '');
  const body = req.body || {};

  if (req.method === 'GET') {
    if (k === 'list') {
      if (!canCreate(u) && !seesAll(u)) throw new HttpError(403, 'You do not have access to quotations.');
      const rows = seesAll(u) ? await q`SELECT * FROM quotes ORDER BY updated_at DESC LIMIT 1000` : await q`SELECT * FROM quotes WHERE created_by = ${u.id} ORDER BY updated_at DESC LIMIT 1000`;
      return res.json({ quotes: rows.map((r) => quoteSummary(r, u)), me: { canCreate: canCreate(u), slot: slotOf(u), seesAll: seesAll(u) } });
    }
    if (k === 'get') {
      const [r] = await q`SELECT * FROM quotes WHERE id = ${String(req.query.id || '')}`;
      if (!r || !canSeeQuote(u, r)) throw new HttpError(404, 'Quotation not found.');
      let invoiceNo = '';
      if (r.invoice_id) { const [i] = await q`SELECT no FROM invoices WHERE id = ${r.invoice_id}`; invoiceNo = i ? i.no : ''; }
      return res.json({ quote: { ...quoteOut(r, u), invoiceNo } });
    }
    if (k === 'products') {
      if (!canCreate(u)) throw new HttpError(403, 'You cannot create quotations.');
      const s = String(req.query.s || '').trim().toLowerCase();
      const { list, currency } = await products();
      if (!s) return res.json({ products: list.slice(0, 30), currency, total: list.length });
      const exact = list.filter((p) => p.barcode && p.barcode.toLowerCase() === s);
      const words = s.split(/\s+/).filter(Boolean);
      const hits = list.filter((p) => !exact.includes(p) && words.every((w) => (p.name + ' ' + p.code + ' ' + p.barcode).toLowerCase().includes(w)));
      return res.json({ products: [...exact, ...hits].slice(0, 30), exact: exact.length === 1 ? exact[0] : null, currency, total: list.length });
    }
    if (k === 'customers') {
      if (!canCreate(u)) throw new HttpError(403, 'You cannot create quotations.');
      return res.json({ customers: await customers(String(req.query.s || '').trim().slice(0, 60)) });
    }
    if (k === 'invoices') {
      const rows = (seesAll(u) || isWarehouse(u)) ? await q`SELECT * FROM invoices ORDER BY created_at DESC LIMIT 1000` : await q`SELECT * FROM invoices WHERE quote_by = ${u.id} ORDER BY created_at DESC LIMIT 1000`;
      return res.json({ invoices: rows.map((r) => { const o = invoiceOut(r, u); delete o.lines; delete o.whHistory; return o; }), me: { move: canMoveWarehouse(u), money: !isWarehouse(u) } });
    }
    if (k === 'invoice') {
      const [r] = await q`SELECT * FROM invoices WHERE id = ${String(req.query.id || '')}`;
      if (!r || !canSeeInvoice(u, r)) throw new HttpError(404, 'Invoice not found.');
      return res.json({ invoice: invoiceOut(r, u) });
    }
    if (k === 'wh') {
      if (!isWarehouse(u) && !seesAll(u)) throw new HttpError(403, 'Only the warehouse team can open this.');
      const rows = await q`SELECT * FROM invoices WHERE wh_status <> 'transferred' OR updated_at > ${Date.now() - 30 * 864e5} ORDER BY created_at ASC LIMIT 600`;
      return res.json({ invoices: rows.map((r) => invoiceOut(r, u)), me: { move: canMoveWarehouse(u), money: !isWarehouse(u) } });
    }
    throw new HttpError(400, 'Unknown request.');
  }

  // ---------- changes
  const a = String(body.action || '');
  const now = Date.now();
  const load = async (id) => { const [r] = await q`SELECT * FROM quotes WHERE id = ${String(id || '')}`; if (!r || !canSeeQuote(u, r)) throw new HttpError(404, 'Quotation not found.'); return r; };

  if (a === 'save') {
    if (!canCreate(u)) throw new HttpError(403, 'You cannot create quotations.');
    const customer = cleanCustomer(body.customer || {});
    const lines = cleanLines(body.lines || []);
    const discount = cleanDiscount(body.discount || {});
    const notes = str(body.notes, 3000);
    const tax = cleanTax(body.tax || {});
    const priced = priceQuote(lines, discount, tax);
    const currency = str(body.currency, 3) || prodCache.currency || 'EGP';
    if (!body.id) {
      const [{ n }] = await q`SELECT nextval('quote_no_seq')::int AS n`;
      const no = `Q-${new Date(now).getFullYear()}-${String(n).padStart(4, '0')}`, id = rid('q');
      const hist = [ev(u, 'created')];
      await q`INSERT INTO quotes (id, no, created_at, updated_at, created_by, created_by_name, customer, lines, discount, tax, notes, subtotal, discount_total, total, currency, status, approvals, history)
        VALUES (${id}, ${no}, ${now}, ${now}, ${u.id}, ${u.username}, ${JSON.stringify(customer)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(discount)}::jsonb, ${JSON.stringify(tax)}::jsonb, ${notes},
        ${priced.subtotal}, ${priced.discountTotal}, ${priced.total}, ${currency}, 'draft', ${JSON.stringify(blankApprovals())}::jsonb, ${JSON.stringify(hist)}::jsonb)`;
      const [r] = await q`SELECT * FROM quotes WHERE id = ${id}`;
      return res.json({ quote: quoteOut(r, u) });
    }
    const r = await load(body.id);
    if (!canEditQuote(u, r)) throw new HttpError(409, 'This quotation can no longer be edited.');
    const hist = [...J(r.history, []), ev(u, r.status === 'rejected' ? 'edited after rejection' : 'edited')].slice(-200);
    await q`UPDATE quotes SET customer = ${JSON.stringify(customer)}::jsonb, lines = ${JSON.stringify(lines)}::jsonb, discount = ${JSON.stringify(discount)}::jsonb, tax = ${JSON.stringify(tax)}::jsonb, notes = ${notes},
      subtotal = ${priced.subtotal}, discount_total = ${priced.discountTotal}, total = ${priced.total}, currency = ${currency}, status = 'draft', updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id}`;
    const [r2] = await q`SELECT * FROM quotes WHERE id = ${r.id}`;
    return res.json({ quote: quoteOut(r2, u) });
  }

  if (a === 'submit') {
    const r = await load(body.id);
    if (!canEditQuote(u, r)) throw new HttpError(409, 'Only a draft can be submitted.');
    if (!J(r.lines, []).length) throw new HttpError(400, 'Add at least one item before submitting.');
    const until = now + VALID_DAYS * DAY;
    const hist = [...J(r.history, []), ev(u, `submitted for approval (valid until ${new Date(until).toISOString().slice(0, 10)})`)].slice(-200);
    await q`UPDATE quotes SET status = 'pending', valid_until = ${until}, approvals = ${JSON.stringify(blankApprovals())}::jsonb, submitted_at = ${now}, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id}`;
    const [r2] = await q`SELECT * FROM quotes WHERE id = ${r.id}`;
    return res.json({ quote: quoteOut(r2, u) });
  }

  if (a === 'withdraw') {
    const r = await load(body.id);
    if (!(r.status === 'pending' || (r.status === 'approved' && isExpired(r))) || (r.created_by !== u.id && u.role !== 'super_admin')) throw new HttpError(409, 'Only a quotation waiting for approval, or an expired one, can be taken back.');
    const hist = [...J(r.history, []), ev(u, 'taken back to edit')].slice(-200);
    await q`UPDATE quotes SET status = 'draft', valid_until = NULL, approvals = ${JSON.stringify(blankApprovals())}::jsonb, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id}`;
    const [r2] = await q`SELECT * FROM quotes WHERE id = ${r.id}`;
    return res.json({ quote: quoteOut(r2, u) });
  }

  if (a === 'approve' || a === 'reject') {
    const slot = slotOf(u);
    if (!slot) throw new HttpError(403, 'Only Finance, the CEO and the Super Admin approve quotations.');
    const r = await load(body.id);
    if (r.status !== 'pending') throw new HttpError(409, 'This quotation is not waiting for approval.');
    if (isExpired(r)) throw new HttpError(409, 'This quotation has expired. The Super Admin or the CEO can extend it, or the creator can take it back and submit it again.');
    const ap = { ...blankApprovals(), ...J(r.approvals, {}) };
    if (ap[slot].state !== 'pending') throw new HttpError(409, 'You have already decided on this quotation.');
    const note = str(body.note, 1000);
    if (a === 'reject' && !note) throw new HttpError(400, 'Write the reason for rejecting, so it can be fixed.');
    ap[slot] = { state: a === 'approve' ? 'approved' : 'rejected', by: u.id, byName: u.username, at: now, note };
    const all = SLOTS.every((s) => ap[s].state === 'approved');
    const status = a === 'reject' ? 'rejected' : all ? 'approved' : 'pending';
    const hist = [...J(r.history, []), ev(u, a === 'approve' ? `approved as ${SLOT_LABEL[slot]}` : `rejected as ${SLOT_LABEL[slot]}`, note), ...(all ? [{ at: now, by: '', byName: 'Hub', role: '', action: 'fully approved: ready to convert to an invoice', note: '' }] : [])].slice(-200);
    // only update if nobody changed it in the meantime
    const done = await q`UPDATE quotes SET approvals = ${JSON.stringify(ap)}::jsonb, status = ${status}, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id} AND status = 'pending' AND updated_at = ${r.updated_at} RETURNING id`;
    if (!done.length) throw new HttpError(409, 'Someone changed this quotation at the same moment. Reload and try again.');
    const [r2] = await q`SELECT * FROM quotes WHERE id = ${r.id}`;
    return res.json({ quote: quoteOut(r2, u) });
  }

  if (a === 'extend') {
    // exception: the Super Admin or the CEO moves the expiry date
    if (!canExtend(u)) throw new HttpError(403, 'Only the Super Admin or the CEO can change the expiry date.');
    const r = await load(body.id);
    if (!['pending', 'approved'].includes(r.status)) throw new HttpError(409, 'Only a submitted or approved quotation has an expiry date.');
    let until = Number(body.until);
    if (!Number.isFinite(until)) throw new HttpError(400, 'Choose the new expiry date.');
    until = Math.min(until, now + 90 * DAY);
    if (until <= now) throw new HttpError(400, 'The new expiry date must be in the future.');
    const note = str(body.note, 500);
    const hist = [...J(r.history, []), ev(u, `changed the expiry date to ${new Date(until).toISOString().slice(0, 10)} (exception)`, note)].slice(-200);
    await q`UPDATE quotes SET valid_until = ${until}, updated_at = ${now}, history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id}`;
    const [r2] = await q`SELECT * FROM quotes WHERE id = ${r.id}`;
    return res.json({ quote: quoteOut(r2, u) });
  }

  if (a === 'delete') {
    const r = await load(body.id);
    if (!canEditQuote(u, r) || r.status !== 'draft') throw new HttpError(409, 'Only a draft can be deleted.');
    await q`DELETE FROM quotes WHERE id = ${r.id} AND status = 'draft'`;
    return res.json({ ok: true });
  }

  if (a === 'convert') {
    const r = await load(body.id);
    if (r.status !== 'approved') throw new HttpError(409, 'All three approvals are needed before converting to an invoice.');
    const ap = J(r.approvals, {});
    if (!SLOTS.every((s) => ap[s] && ap[s].state === 'approved')) throw new HttpError(409, 'All three approvals are needed before converting to an invoice.');
    if (!canConvert(u, r)) throw new HttpError(403, 'You cannot convert this quotation.');
    if (isExpired(r)) throw new HttpError(409, 'This quotation has expired. The Super Admin or the CEO can extend it first.');
    const [{ n }] = await q`SELECT nextval('invoice_no_seq')::int AS n`;
    const no = `INV-${new Date(now).getFullYear()}-${String(n).padStart(4, '0')}`, id = rid('i');
    // claim the quote first so it can never become two invoices
    const claimed = await q`UPDATE quotes SET status = 'invoiced', invoice_id = ${id}, updated_at = ${now} WHERE id = ${r.id} AND status = 'approved' RETURNING id`;
    if (!claimed.length) throw new HttpError(409, 'This quotation was already converted.');
    const lines = J(r.lines, []), discount = J(r.discount, {}), tax = cleanTax(J(r.tax, {})), priced = priceQuote(lines, discount, tax);
    const whh = [{ at: now, by: u.id, byName: u.username, status: 'ready', note: 'Invoice created' }];
    await q`INSERT INTO invoices (id, no, quote_id, quote_no, created_at, updated_at, created_by, created_by_name, quote_by, quote_by_name, customer, lines, discount, tax, notes, subtotal, discount_total, total, currency, approvals, wh_status, wh_history)
      VALUES (${id}, ${no}, ${r.id}, ${r.no}, ${now}, ${now}, ${u.id}, ${u.username}, ${r.created_by}, ${r.created_by_name}, ${JSON.stringify(r.customer)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(discount)}::jsonb, ${JSON.stringify(tax)}::jsonb, ${r.notes},
      ${priced.subtotal}, ${priced.discountTotal}, ${priced.total}, ${r.currency}, ${JSON.stringify(ap)}::jsonb, 'ready', ${JSON.stringify(whh)}::jsonb)`;
    const hist = [...J(r.history, []), ev(u, `converted to invoice ${no}`)].slice(-200);
    await q`UPDATE quotes SET history = ${JSON.stringify(hist)}::jsonb WHERE id = ${r.id}`;
    return res.json({ invoiceId: id, invoiceNo: no });
  }

  if (a === 'wh') {
    if (!canMoveWarehouse(u)) throw new HttpError(403, 'Only the warehouse team can change this.');
    const status = String(body.status || '');
    if (!WH_STEPS.includes(status)) throw new HttpError(400, 'Unknown warehouse step.');
    const [r] = await q`SELECT * FROM invoices WHERE id = ${String(body.id || '')}`;
    if (!r) throw new HttpError(404, 'Invoice not found.');
    if (r.wh_status === status) return res.json({ invoice: invoiceOut(r, u) });
    const hist = [...J(r.wh_history, []), { at: now, by: u.id, byName: u.username, status, note: str(body.note, 500) }].slice(-100);
    await q`UPDATE invoices SET wh_status = ${status}, wh_history = ${JSON.stringify(hist)}::jsonb, updated_at = ${now} WHERE id = ${r.id}`;
    const [r2] = await q`SELECT * FROM invoices WHERE id = ${r.id}`;
    return res.json({ invoice: invoiceOut(r2, u) });
  }

  throw new HttpError(400, 'Unknown action.');
}

/** Small counts for the menu badges. */
export async function quoteCounts(u) {
  try {
    const slot = slotOf(u), out = {};
    if (!slot && !isWarehouse(u)) return out;
    await ensureQuotes();
    const q = db();
    if (slot) { const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM quotes WHERE status = 'pending' AND (valid_until IS NULL OR valid_until > ${Date.now()}) AND approvals -> ${slot} ->> 'state' = 'pending'`; out.approve = n; }
    if (isWarehouse(u) || u.role === 'super_admin') { const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM invoices WHERE wh_status = 'ready'`; out.wh = n; }
    return out;
  } catch (e) { return {}; }
}
