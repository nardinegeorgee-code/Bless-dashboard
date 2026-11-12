import { db, requireUser, HttpError, rid } from './_lib.js';
import { odooConfig, call, sr, nm, fieldsOf } from './_odoo.js';
import { shopConfig, fetchSkuImages } from './_shopify.js';

/**
 * Product catalogue for the whole team.
 * Products, codes, barcodes, prices and pictures are read from Odoo (pictures from Shopify when the code matches).
 * What Odoo does not hold is kept here: the line a product belongs to, how to use it, a description, design files,
 * a replacement photo, and products added by hand.
 */
export const LINES = ['Shea line', 'Argan line', 'Vitamin E line', 'Coconut line', 'Activator line', 'Sulfate free shampoo', 'Gels', 'Shower gels', 'Satins', 'Accessories', 'Offers and bundles', 'Other'];

/** Best guess of the line from the product name. The Super Admin can always move a product to another line. */
export function guessLine(name) {
  const x = ' ' + String(name || '').toLowerCase().replace(/^\s*\[[^\]]*\]\s*/, '') + ' ';
  if (/satin|ساتان/.test(x)) return 'Satins';
  if (/bonnet|brush|comb|towel|turban|scrunch|clip|spray bottle|applicator|diffuser|pillow|accessor|bag\b|مشط|فرشا/.test(x)) return 'Accessories';
  if (/offer|bundle|\bset\b|\bkit\b|\+|عرض/.test(x)) return 'Offers and bundles';
  if (/shower\s*gel|body\s*wash|شاور/.test(x)) return 'Shower gels';
  if (/sul(f|ph)ate/.test(x)) return 'Sulfate free shampoo';
  if (/activator|اكتيف|أكتيف/.test(x)) return 'Activator line';
  if (/\bgel\b|جل/.test(x)) return 'Gels';
  if (/shea|شيا/.test(x)) return 'Shea line';
  if (/argan|ارجان|أرجان/.test(x)) return 'Argan line';
  if (/vit(amin)?\.?\s*-?\s*e\b|فيتامين/.test(x)) return 'Vitamin E line';
  if (/coconut|coco\b|جوز الهند/.test(x)) return 'Coconut line';
  return 'Other';
}

/**
 * Only finished products belong in the catalogue. Raw materials (code R-), packaging (code P-), services, fees,
 * discounts, conversion costs, Shopify system items, uniforms and bare barcode numbers are left out.
 * Finished products carry codes like F-2020103.
 */
const NOT_FINISHED_NAME = /conversion cost|discount|\bfees?\b|\btips?\b|tip product|shopify|gift card|down payment|top-?up|e-?wallet|cliche|\(service\)|t-?shirt|marketing|refund|shipping|delivery|commission|deposit|carton|sticker|^stai$/i;
const NOT_FINISHED_CATEG = /raw|material|packag|service|expense|fee|discount|consumable|semi/i;
export function isFinished(p) {
  const code = String(p.code || '').trim().toUpperCase(), name = String(p.name || '').trim();
  if (/^[RP]-/.test(code)) return false;
  if (p.type === 'service') return false;
  if (/^[\d\s-]{8,}$/.test(name)) return false;
  if (NOT_FINISHED_NAME.test(name)) return false;
  if (NOT_FINISHED_CATEG.test(String(p.group || ''))) return false;
  return true;
}

const str = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const cleanFiles = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f.url === 'string' && /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(f.url)).slice(0, 40)
  .map((f) => ({ url: f.url, name: str(f.name, 200) || 'file', type: str(f.type, 80), size: Number(f.size) || 0 }));
const stripHtml = (v) => String(v || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

let odooMemo = { at: 0, v: null };
async function odooProducts(fresh) {
  if (!fresh && odooMemo.v && Date.now() - odooMemo.at < 5 * 60000) return odooMemo.v;
  const cfg = odooConfig();
  if (cfg.missing.length) return { list: [], warn: 'Odoo is not connected, so only products added by hand are shown.' };
  try {
    const have = await fieldsOf(cfg, 'product.product');
    if (!have) throw new Error('the product list is not available in Odoo');
    const dom = [['active', '=', true], ...(have.has('sale_ok') ? [['sale_ok', '=', true]] : [])];
    const list = await sr(cfg, 'product.product', dom, ['display_name', 'default_code', 'barcode', 'categ_id', 'list_price', 'description_sale', 'write_date', ...(have.has('detailed_type') ? ['detailed_type'] : have.has('type') ? ['type'] : [])], { limit: 5000 });
    let pics = { bySku: {}, byName: {} };
    try { const sc = shopConfig(); if (sc && !(sc.missing || []).length) pics = (await fetchSkuImages(sc)) || pics; } catch (err) { /* Odoo pictures are used instead */ }
    let currency = '';
    try { const c = await call(cfg, 'res.company', 'search_read', [[]], { fields: ['currency_id'], limit: 1 }); currency = nm(c[0]?.currency_id); } catch (err) { /* price shows without a currency */ }
    const out = list.map((p) => {
      const code = String(p.default_code || '').trim(), name = String(p.display_name || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
      const shopImg = (code && pics.bySku && pics.bySku[code.toLowerCase()]) || (pics.byName && pics.byName[name.toLowerCase()]) || '';
      return { key: 'o' + p.id, pid: p.id, type: String(p.detailed_type || p.type || ''), name, code, barcode: String(p.barcode || '').trim(), price: Number(p.list_price) || 0, group: nm(p.categ_id), odooDesc: stripHtml(p.description_sale), img: shopImg || `/api/odoo?catalog=img&id=${p.id}&v=${encodeURIComponent(String(p.write_date || '').slice(0, 19))}` };
    });
    odooMemo = { at: Date.now(), v: { list: out.filter(isFinished), currency } };
    return odooMemo.v;
  } catch (err) {
    return { list: [], warn: 'Odoo could not be read just now (' + String(err.message || err).slice(0, 140) + '). Products added by hand are still shown.' };
  }
}

const MIME = [['/9j/', 'image/jpeg'], ['iVBOR', 'image/png'], ['R0lGO', 'image/gif'], ['UklGR', 'image/webp']];
async function sendImage(req, res) {
  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Unknown product.');
  const cfg = odooConfig();
  if (cfg.missing.length) throw new HttpError(404, 'No picture.');
  const have = await fieldsOf(cfg, 'product.product');
  const f = have && have.has('image_512') ? 'image_512' : have && have.has('image_256') ? 'image_256' : '';
  const got = f ? await call(cfg, 'product.product', 'read', [[id], [f]]) : [];
  const b = got[0] && typeof got[0][f] === 'string' ? got[0][f] : '', m = b && MIME.find(([p]) => b.startsWith(p));
  if (!m) { res.setHeader('Cache-Control', 'private, max-age=600'); return res.status(404).json({ error: 'No picture.' }); }
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.status(200).send(Buffer.from(b, 'base64'));
}

export async function catalog(req, res) {
  const me = await requireUser(req);
  const admin = me.role === 'super_admin';
  if (req.method === 'GET' && req.query.catalog === 'img') return sendImage(req, res);
  const q = db();
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    if (!admin) throw new HttpError(403, 'Only the Super Admin can change the catalogue.');
    const b = req.body || {};
    if (b.action === 'delete') {
      const key = str(b.key, 40);
      if (!/^c/.test(key)) throw new HttpError(400, 'Only products added by hand can be deleted. Hide an Odoo product instead.');
      await q`DELETE FROM catalog_items WHERE key = ${key}`;
      return res.json({ ok: true });
    }
    let key = str(b.key, 40);
    const custom = !key || /^c/.test(key);
    if (!key) key = rid('c');
    if (!/^(o\d+|c[a-z0-9]+)$/.test(key)) throw new HttpError(400, 'Unknown product.');
    const line = LINES.includes(b.line) ? b.line : '';
    const name = custom ? str(b.name, 200) : '';
    if (custom && !name) throw new HttpError(400, 'Give the product a name.');
    const photo = cleanFiles(b.photo ? [b.photo] : [])[0] || null;
    await q`INSERT INTO catalog_items (key, line, usage, description, files, photo, hidden, name, code, barcode, updated_at, updated_by)
      VALUES (${key}, ${line}, ${str(b.usage, 3000)}, ${str(b.description, 6000)}, ${JSON.stringify(cleanFiles(b.files))}::jsonb, ${photo ? JSON.stringify(photo) : null}::jsonb, ${!!b.hidden}, ${name}, ${custom ? str(b.code, 80) : ''}, ${custom ? str(b.barcode, 40) : ''}, ${Date.now()}, ${me.id})
      ON CONFLICT (key) DO UPDATE SET line = EXCLUDED.line, usage = EXCLUDED.usage, description = EXCLUDED.description, files = EXCLUDED.files, photo = EXCLUDED.photo, hidden = EXCLUDED.hidden, name = EXCLUDED.name, code = EXCLUDED.code, barcode = EXCLUDED.barcode, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`;
    return res.json({ ok: true, key });
  }

  const [od, rows] = await Promise.all([odooProducts(req.query.fresh === '1'), q`SELECT * FROM catalog_items`]);
  const extra = new Map(rows.map((r) => [r.key, r]));
  const merge = (base, r) => {
    const auto = guessLine(base.name);
    return { ...base, line: (r && r.line) || auto, auto: !(r && r.line), usage: (r && r.usage) || '', description: (r && r.description) || '', files: (r && r.files) || [], photo: (r && r.photo) || null, hidden: !!(r && r.hidden), updatedAt: r ? Number(r.updated_at) : null };
  };
  const items = od.list.map((p) => merge(p, extra.get(p.key)));
  for (const r of rows) if (/^c/.test(r.key)) items.push(merge({ key: r.key, pid: null, custom: true, name: r.name || 'Unnamed product', code: r.code || '', barcode: r.barcode || '', price: 0, group: '', odooDesc: '', img: '' }, r));
  const shown = (admin ? items : items.filter((i) => !i.hidden)).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ lines: LINES, items: shown, canEdit: admin, currency: od.currency || '', warn: od.warn || '' });
}
