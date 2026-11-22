// Quotations, approvals, invoices and the warehouse queue.
// Served through /api/data?q=... because the Vercel Hobby plan allows only 12 functions.
//
// Flow: Draft -> Pending approval (Finance, CEO and Super Admin approve in ANY order, all three needed)
//       -> Approved -> "Convert to invoice" button -> Invoice (Ready for Warehouse -> Preparing -> Transferred to Distributor).
// Any rejection sends the quote back to its creator (Rejected); editing it makes it a Draft again and
// submitting again resets all three approvals.
//
// Tax: product prices (Odoo) already INCLUDE VAT. 'included' = charge the price as it is (VAT shown inside);
// 'excluded' = quote without VAT: every price is divided by (1 + rate), e.g. 120 / 1.14 = 105.26, and no VAT is added.
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
export const DEFAULT_TAX = { mode: 'included', rate: 14 };
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
      await q`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS example BOOLEAN NOT NULL DEFAULT false`;
      await q`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS example BOOLEAN NOT NULL DEFAULT false`;
      await q`CREATE SEQUENCE IF NOT EXISTS example_no_seq`;
      await q`CREATE SEQUENCE IF NOT EXISTS example_inv_seq`;
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
  const mode = t && t.mode === 'excluded' ? 'excluded' : 'included';
  const rate = t && t.rate !== undefined && t.rate !== '' && Number.isFinite(Number(t.rate)) ? Math.min(100, Math.max(0, Number(t.rate))) : DEFAULT_TAX.rate;
  return { mode, rate };
}
export function priceQuote(lines, orderDiscount, taxIn) {
  const tax = cleanTax(taxIn), f = tax.mode === 'excluded' ? 1 / (1 + tax.rate / 100) : 1;
  // l.price is always the VAT-inclusive price; unit is the price shown on this quote
  const out = lines.map((l) => {
    const unit = r2(l.price * f), base = r2(l.price * f * l.qty), disc = discountAmount(base, l.discount, { line: l });
    return { ...l, unit, listUnit: l.listPrice == null ? null : r2(l.listPrice * f), base, disc, net: r2(base - disc) };
  });
  const subtotal = r2(out.reduce((a, l) => a + l.net, 0));
  const lineDisc = r2(out.reduce((a, l) => a + l.disc, 0));
  const orderDisc = discountAmount(subtotal, orderDiscount, { quote: true });
  const amount = r2(subtotal - orderDisc);
  // included: the customer pays the amount, and the VAT inside it is shown. excluded: prices were already divided, no VAT charged.
  const untaxed = tax.mode === 'excluded' ? amount : r2(amount / (1 + tax.rate / 100));
  const taxAmount = tax.mode === 'excluded' ? 0 : r2(amount - untaxed);
  const total = amount;
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
    example: !!r.example, notes: r.notes, tax: cleanTax(J(r.tax, {})), totals: priced, currency: r.currency, status: r.status, expired, validUntil: r.valid_until ? Number(r.valid_until) : 0, approvals: ap, history: J(r.history, []), invoiceId: r.invoice_id || null,
    can: u ? { edit: canEditQuote(u, r), convert: r.status === 'approved' && !expired && canConvert(u, r), approve: r.status === 'pending' && !expired && !!slotOf(u) && ap[slotOf(u)] && ap[slotOf(u)].state === 'pending', withdraw: (r.status === 'pending' || (r.status === 'approved' && expired)) && (r.created_by === u.id || u.role === 'super_admin'), extend: ['pending', 'approved'].includes(r.status) && canExtend(u), del: canEditQuote(u, r) && r.status === 'draft' } : {},
  };
}
function quoteSummary(r, u) {
  const o = quoteOut(r, u);
  return { id: o.id, no: o.no, createdAt: o.createdAt, updatedAt: o.updatedAt, createdBy: o.createdBy, createdByName: o.createdByName, customer: o.customer, items: o.lines.length, units: o.lines.reduce((a, l) => a + l.qty, 0), total: o.totals.total, example: o.example, taxMode: o.tax.mode, currency: o.currency, status: o.status, expired: o.expired, validUntil: o.validUntil, approvals: o.approvals, invoiceId: o.invoiceId, priceChanged: o.lines.some((l) => l.listPrice != null && Math.abs(l.listPrice - l.price) > 0.004), can: o.can };
}
function invoiceOut(r, u) {
  const hideMoney = u && isWarehouse(u);
  const priced = priceQuote(J(r.lines, []), J(r.discount, {}), J(r.tax, {}));
  const lines = priced.lines.map((l) => (hideMoney ? { pid: l.pid, name: l.name, code: l.code, barcode: l.barcode, qty: l.qty } : l));
  return {
    id: r.id, no: r.no, example: !!r.example, quoteId: r.quote_id, quoteNo: r.quote_no, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), createdByName: r.created_by_name, quoteByName: r.quote_by_name,
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

  if (a === 'examples' || a === 'examples-clear') {
    if (u.role !== 'super_admin') throw new HttpError(403, 'Only the Super Admin can add or remove examples.');
    await q`DELETE FROM invoices WHERE example`;
    await q`DELETE FROM quotes WHERE example`;
    if (a === 'examples-clear') return res.json({ ok: true });
    const made = await makeExamples(q, u);
    return res.json({ ok: true, made });
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
    const [{ n }] = r.example ? await q`SELECT nextval('example_inv_seq')::int AS n` : await q`SELECT nextval('invoice_no_seq')::int AS n`;
    const no = r.example ? `EX-INV-${String(n).padStart(4, '0')}` : `INV-${new Date(now).getFullYear()}-${String(n).padStart(4, '0')}`, id = rid('i');
    // claim the quote first so it can never become two invoices
    const claimed = await q`UPDATE quotes SET status = 'invoiced', invoice_id = ${id}, updated_at = ${now} WHERE id = ${r.id} AND status = 'approved' RETURNING id`;
    if (!claimed.length) throw new HttpError(409, 'This quotation was already converted.');
    const lines = J(r.lines, []), discount = J(r.discount, {}), tax = cleanTax(J(r.tax, {})), priced = priceQuote(lines, discount, tax);
    const whh = [{ at: now, by: u.id, byName: u.username, status: 'ready', note: 'Invoice created' }];
    await q`INSERT INTO invoices (id, no, quote_id, quote_no, created_at, updated_at, created_by, created_by_name, quote_by, quote_by_name, customer, lines, discount, tax, notes, subtotal, discount_total, total, currency, approvals, wh_status, wh_history, example)
      VALUES (${id}, ${no}, ${r.id}, ${r.no}, ${now}, ${now}, ${u.id}, ${u.username}, ${r.created_by}, ${r.created_by_name}, ${JSON.stringify(r.customer)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(discount)}::jsonb, ${JSON.stringify(tax)}::jsonb, ${r.notes},
      ${priced.subtotal}, ${priced.discountTotal}, ${priced.total}, ${r.currency}, ${JSON.stringify(ap)}::jsonb, 'ready', ${JSON.stringify(whh)}::jsonb, ${!!r.example})`;
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

// ---------- examples: one of every step of the cycle, clearly marked, separate numbers, removable
const SAMPLE_PRODUCTS = [
  { pid: null, name: 'Shea Butter Shampoo 400ml', code: 'SH-400', barcode: '6224000000011', price: 185 },
  { pid: null, name: 'Argan Oil Hair Serum 100ml', code: 'AR-100', barcode: '6224000000028', price: 240 },
  { pid: null, name: 'Vitamin E Leave-in Cream 250ml', code: 'VE-250', barcode: '6224000000035', price: 165 },
  { pid: null, name: 'Coconut Conditioner 400ml', code: 'CO-400', barcode: '6224000000042', price: 175 },
  { pid: null, name: 'Activator Curl Gel 300ml', code: 'AC-300', barcode: '6224000000059', price: 150 },
  { pid: null, name: 'Sulfate Free Shampoo 400ml', code: 'SF-400', barcode: '6224000000066', price: 210 },
];
async function makeExamples(q, admin) {
  let prods = [];
  try { prods = (await products()).list.filter((p) => p.price > 0 && p.name).slice(0, 12); } catch (e) { prods = []; }
  if (prods.length < 6) prods = SAMPLE_PRODUCTS;
  const users = await q`SELECT id, username, role FROM users`;
  const who = (role, label) => users.find((x) => x.role === role) || { id: '', username: `${label} (example)`, role };
  const sales = users.find((x) => x.role === 'salesperson') || admin;
  const fin = who('finance', 'Finance'), ceo = who('ceo', 'CEO'), sa = users.find((x) => x.id === admin.id) || admin;
  const now = Date.now(), H = 36e5;
  const line = (k, qty, disc) => { const p = prods[k % prods.length]; return { pid: p.pid, name: p.name, code: p.code || '', barcode: p.barcode || '', listPrice: p.price, price: p.price, qty, discount: cleanDiscount(disc || {}) }; };
  const A = (x, state, at, note = '') => ({ state, by: x.id, byName: x.username, at, note });
  const P = { state: 'pending', by: '', byName: '', at: 0, note: '' };
  const E = (x, at, action, note = '') => ({ at, by: x.id, byName: x.username, role: x.role, action, note });
  const scen = [
    { cust: ['Giza Beauty Store', 'Giza', '0101 111 2222'], lines: [line(0, 12), line(2, 6)], status: 'draft', created: now - 2 * H, notes: 'Still collecting the full order from the shop owner.' },
    { cust: ['Nile Distribution', 'Cairo', '0100 123 4567'], lines: [line(0, 48, { type: 'percent', value: 5 }), line(1, 24), line(3, 36)], status: 'pending', created: now - 26 * H, sub: now - 24 * H, ap: { finance: P, ceo: A(ceo, 'approved', now - 20 * H, 'Good distributor, approved.'), super_admin: P } },
    { cust: ['Delta Beauty Supplies', 'Tanta', '0122 333 4444'], lines: [line(4, 60), line(5, 30, { type: 'amount', value: 300 })], discount: { type: 'percent', value: 3 }, status: 'pending', created: now - 70 * H, sub: now - 67 * H, ap: { finance: A(fin, 'approved', now - 60 * H), ceo: P, super_admin: A(sa, 'approved', now - 50 * H) } },
    { cust: ['Alexandria Care Center', 'Alexandria', '0111 555 6666'], lines: [line(1, 20), line(2, 40), line(5, 20)], status: 'approved', created: now - 40 * H, sub: now - 38 * H, ap: { finance: A(fin, 'approved', now - 30 * H), ceo: A(ceo, 'approved', now - 28 * H), super_admin: A(sa, 'approved', now - 26 * H) }, notes: 'Ready to convert: all three approved.' },
    { cust: ['Red Sea Pharmacies', 'Hurghada', '0155 777 8888'], lines: [line(0, 100, { type: 'percent', value: 20 }), line(3, 50, { type: 'percent', value: 20 })], status: 'rejected', created: now - 30 * H, sub: now - 29 * H, ap: { finance: A(fin, 'rejected', now - 22 * H, 'Discount too high for this distributor: 10% maximum. Please lower it and resubmit.'), ceo: P, super_admin: P } },
    { cust: ['Upper Egypt Traders', 'Assiut', '0106 999 0000'], lines: [line(2, 36), line(4, 24)], status: 'pending', created: now - 110 * H, sub: now - 100 * H, valid: now - 28 * H, ap: { finance: A(fin, 'approved', now - 90 * H), ceo: P, super_admin: P }, notes: 'Example of an expired quotation: not approved within 3 days.' },
    { cust: ['Mansoura Beauty House', 'Mansoura', '0109 121 3434'], lines: [line(0, 24), line(1, 12), line(2, 24)], status: 'invoiced', created: now - 50 * H, sub: now - 48 * H, wh: 'ready' },
    { cust: ['Zagazig Cosmetics', 'Zagazig', '0128 565 7878'], lines: [line(3, 60), line(5, 36)], status: 'invoiced', created: now - 80 * H, sub: now - 78 * H, wh: 'preparing' },
    { cust: ['Ismailia Salon Supplies', 'Ismailia', '0114 242 5656'], lines: [line(1, 30), line(4, 30)], tax: { mode: 'excluded', rate: 14 }, status: 'invoiced', created: now - 140 * H, sub: now - 136 * H, wh: 'transferred', notes: 'Example of a quotation without VAT (prices divided by 1.14).' },
  ];
  const made = [];
  for (const sc of scen) {
    const [{ n }] = await q`SELECT nextval('example_no_seq')::int AS n`;
    const no = `EX-Q-${String(n).padStart(4, '0')}`, id = rid('q');
    const customer = { id: null, name: sc.cust[0], city: sc.cust[1], phone: sc.cust[2] };
    const discount = cleanDiscount(sc.discount || {}), tax = cleanTax(sc.tax || {}), priced = priceQuote(sc.lines, discount, tax);
    const full = sc.status === 'approved' || sc.status === 'invoiced';
    const ap = sc.ap || (full || sc.status === 'invoiced' ? { finance: A(fin, 'approved', sc.sub + 6 * H), ceo: A(ceo, 'approved', sc.sub + 9 * H), super_admin: A(sa, 'approved', sc.sub + 12 * H) } : blankApprovals());
    const hist = [E(sales, sc.created, 'created')];
    if (sc.sub) hist.push(E(sales, sc.sub, `submitted for approval (valid until ${new Date(sc.valid || sc.sub + VALID_DAYS * DAY).toISOString().slice(0, 10)})`));
    for (const s of SLOTS) if (ap[s].state !== 'pending') hist.push({ at: ap[s].at, by: ap[s].by, byName: ap[s].byName, role: s, action: `${ap[s].state} as ${SLOT_LABEL[s]}`, note: ap[s].note });
    if (full) hist.push({ at: ap.super_admin.at, by: '', byName: 'Hub', role: '', action: 'fully approved: ready to convert to an invoice', note: '' });
    hist.sort((x, y) => x.at - y.at);
    let invoiceId = null;
    const validUntil = sc.sub ? (sc.valid || (sc.status === 'approved' ? now + 30 * H : sc.sub + VALID_DAYS * DAY)) : null;
    if (sc.status === 'invoiced') {
      const [{ m }] = await q`SELECT nextval('example_inv_seq')::int AS m`;
      const ino = `EX-INV-${String(m).padStart(4, '0')}`, iid = rid('i'), at = ap.super_admin.at + 2 * H;
      const steps = WH_STEPS.slice(0, WH_STEPS.indexOf(sc.wh) + 1).map((st, k) => ({ at: at + k * 5 * H, by: k ? '' : sales.id, byName: k ? 'Warehouse (example)' : sales.username, status: st, note: k ? '' : 'Invoice created' }));
      hist.push(E(sales, at, `converted to invoice ${ino}`));
      await q`INSERT INTO invoices (id, no, quote_id, quote_no, created_at, updated_at, created_by, created_by_name, quote_by, quote_by_name, customer, lines, discount, tax, notes, subtotal, discount_total, total, currency, approvals, wh_status, wh_history, example)
        VALUES (${iid}, ${ino}, ${id}, ${no}, ${at}, ${steps[steps.length - 1].at}, ${sales.id}, ${sales.username}, ${sales.id}, ${sales.username}, ${JSON.stringify(customer)}::jsonb, ${JSON.stringify(sc.lines)}::jsonb, ${JSON.stringify(discount)}::jsonb, ${JSON.stringify(tax)}::jsonb, ${sc.notes || ''},
        ${priced.subtotal}, ${priced.discountTotal}, ${priced.total}, ${prodCache.currency || 'EGP'}, ${JSON.stringify(ap)}::jsonb, ${sc.wh}, ${JSON.stringify(steps)}::jsonb, true)`;
      invoiceId = iid;
      made.push(ino);
    }
    await q`INSERT INTO quotes (id, no, created_at, updated_at, created_by, created_by_name, customer, lines, discount, tax, notes, subtotal, discount_total, total, currency, status, approvals, history, invoice_id, submitted_at, valid_until, example)
      VALUES (${id}, ${no}, ${sc.created}, ${hist[hist.length - 1].at}, ${sales.id}, ${sales.username}, ${JSON.stringify(customer)}::jsonb, ${JSON.stringify(sc.lines)}::jsonb, ${JSON.stringify(discount)}::jsonb, ${JSON.stringify(tax)}::jsonb, ${sc.notes || ''},
      ${priced.subtotal}, ${priced.discountTotal}, ${priced.total}, ${prodCache.currency || 'EGP'}, ${sc.status}, ${JSON.stringify(ap)}::jsonb, ${JSON.stringify(hist)}::jsonb, ${invoiceId}, ${sc.sub || null}, ${validUntil}, true)`;
    made.push(no);
  }
  return made;
}

/** Small counts for the menu badges. */
export async function quoteCounts(u) {
  try {
    const slot = slotOf(u), out = {};
    if (!slot && !isWarehouse(u)) return out;
    await ensureQuotes();
    const q = db();
    if (slot) { const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM quotes WHERE status = 'pending' AND NOT example AND (valid_until IS NULL OR valid_until > ${Date.now()}) AND approvals -> ${slot} ->> 'state' = 'pending'`; out.approve = n; }
    if (isWarehouse(u) || u.role === 'super_admin') { const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM invoices WHERE wh_status = 'ready' AND NOT example`; out.wh = n; }
    return out;
  } catch (e) { return {}; }
}
