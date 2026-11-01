import { metaConfig, graph, graphAll, cached as metaCached } from './_meta.js';

const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);

/**
 * Ad spend from Meta for the profit tab. Returns { sum(from,to), monthly(from,to) } or { off: 'why not' }.
 * Ad spend is left out (with a reason) when Meta is not connected or bills in another currency than the store.
 */
export async function adSpend(ctx, shopCurrency) {
  const cfg = metaConfig();
  if (cfg.missing.length) return { off: 'Meta Ads is not connected yet, so ad spend is not counted. Connect it on the Meta Ads page.' };
  try {
    const acct = await metaCached(cfg, 'acct-currency', ctx.refresh, () => graph(cfg, 'GET', 'act_' + cfg.account, { fields: 'currency' }));
    if (shopCurrency && acct.currency && acct.currency !== shopCurrency) return { off: `Your store sells in ${shopCurrency} but the Meta ad account bills in ${acct.currency}, so ad spend cannot be mixed in without a conversion.` };
    const rows = (a, b, extra) => metaCached(cfg, `spend|${a}|${b}|${extra ? 'm' : 't'}`, ctx.refresh, () => graphAll(cfg, 'act_' + cfg.account + '/insights', { fields: 'spend', level: 'account', time_range: { since: a, until: b }, ...(extra ? { time_increment: 'monthly' } : {}), limit: 100 }, 2));
    return {
      sum: async (a, b) => (await rows(a, b, false)).reduce((x, r) => x + (Number(r.spend) || 0), 0),
      byCampaign: async (a, b) => (await metaCached(cfg, `spend|${a}|${b}|c`, ctx.refresh, () => graphAll(cfg, 'act_' + cfg.account + '/insights', { fields: 'spend,campaign_name', level: 'campaign', time_range: { since: a, until: b }, limit: 200 }, 3))).map((r) => ({ name: r.campaign_name || 'Unnamed campaign', spend: Number(r.spend) || 0 })).filter((r) => r.spend > 0).sort((x, y) => y.spend - x.spend),
      monthly: async (a, b) => new Map((await rows(a, b, true)).map((r) => [String(r.date_start).slice(0, 7), Number(r.spend) || 0])),
    };
  } catch (e) { return { off: 'Could not read ad spend from Meta: ' + String(e.message || e).slice(0, 200) }; }
}

/**
 * The cards of a Profit tab with the breakdown behind each one. c and p are { rev, cost, cover, lines } for this period and the
 * comparison period (lines: { name, title, sku, units, rev, unit, cost }). a is the result of adSpend(); camps the ad spend per campaign.
 */
export function profitTiles(c, p, a, s1, s0, camps) {
  const gp = c.rev - c.cost, gp0 = p.rev - p.cost, L = c.lines, LIMIT = 60, skuKey = (l) => l.sku || l.name;
  const nProducts = new Set(L.map((l) => l.title)).size, nSkus = new Set(L.map(skuKey)).size, nUnits = L.reduce((x, l) => x + l.units, 0);
  const withCost = L.filter((l) => l.cost !== null);
  const cut = (rows) => ({ rows: rows.slice(0, LIMIT), more: Math.max(0, rows.length - LIMIT) });
  const base = [{ key: 'name', label: 'Product', fmt: 'str' }, { key: 'sku', label: 'SKU', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int' }];
  const bRev = { summary: [{ l: 'Products', v: nProducts, f: 'int' }, { l: 'SKUs', v: nSkus, f: 'int' }, { l: 'Units', v: nUnits, f: 'int' }, { l: 'Average price per unit', v: nUnits ? c.rev / nUnits : 0, f: 'money2' }],
    columns: [...base, { key: 'price', label: 'Price per unit', fmt: 'money2' }, { key: 'rev', label: 'Net revenue', fmt: 'money' }],
    ...cut(L.map((l) => ({ name: l.name, sku: l.sku || '–', units: l.units, price: l.units ? l.rev / l.units : null, rev: l.rev }))) };
  const wUnits = withCost.reduce((x, l) => x + l.units, 0);
  const bCost = { summary: [{ l: 'Products with a cost', v: new Set(withCost.map((l) => l.title)).size, f: 'int' }, { l: 'SKUs', v: new Set(withCost.map(skuKey)).size, f: 'int' }, { l: 'Units', v: wUnits, f: 'int' }, { l: 'Average cost per unit', v: wUnits ? c.cost / wUnits : 0, f: 'money2' }],
    columns: [...base, { key: 'unit', label: 'Cost per unit', fmt: 'money2' }, { key: 'cost', label: 'Total cost', fmt: 'money' }],
    ...cut(withCost.slice().sort((x, y) => y.cost - x.cost).map((l) => ({ name: l.name, sku: l.sku || '–', units: l.units, unit: l.unit, cost: l.cost }))) };
  const bProfit = { summary: [{ l: 'Margin', v: c.rev ? pct(gp, c.rev) : 0, f: 'pct' }, { l: 'Profit per unit', v: nUnits ? gp / nUnits : 0, f: 'money2' }],
    columns: [...base, { key: 'rev', label: 'Net revenue', fmt: 'money' }, { key: 'cost', label: 'Product cost', fmt: 'money' }, { key: 'profit', label: 'Gross profit', fmt: 'money' }, { key: 'margin', label: 'Margin', fmt: 'pct' }],
    ...cut(withCost.map((l) => ({ name: l.name, sku: l.sku || '–', units: l.units, rev: l.rev, cost: l.cost, profit: l.rev - l.cost, margin: l.rev ? pct(l.rev - l.cost, l.rev) : null })).sort((x, y) => y.profit - x.profit)) };
  const missing = L.filter((l) => l.cost === null);
  const bCover = { summary: [{ l: 'With a known cost', v: withCost.length, f: 'int' }, { l: 'Without a cost', v: missing.length, f: 'int' }], note: missing.length ? 'These products were sold but have no cost to use. Set a Cost on the product in Odoo.' : 'Every product sold has a cost.',
    columns: [{ key: 'name', label: 'Product without a cost', fmt: 'str' }, { key: 'sku', label: 'SKU', fmt: 'str' }, { key: 'units', label: 'Units', fmt: 'int' }, { key: 'rev', label: 'Net revenue', fmt: 'money' }],
    ...cut(missing.map((l) => ({ name: l.name, sku: l.sku || '–', units: l.units, rev: l.rev })).sort((x, y) => y.rev - x.rev)) };
  const tiles = [
    { label: 'Net revenue', value: c.rev, prev: p.rev, fmt: 'money', breakdown: bRev },
    { label: 'Product cost', value: c.cost, prev: p.cost, fmt: 'money', goodDown: true, breakdown: bCost, sub: (c.rev ? pct(c.cost, c.rev) : 0).toFixed(1) + '% of revenue' },
    { label: 'Gross profit', value: gp, prev: gp0, fmt: 'money', breakdown: bProfit, sub: (c.rev ? pct(gp, c.rev) : 0).toFixed(1) + '% margin' },
    { label: 'Revenue with a known cost', value: c.cover, prev: p.cover === null ? undefined : p.cover, fmt: 'pct', breakdown: bCover, sub: 'sales of products that have a cost' },
  ];
  if (a && a.sum) {
    const bAds = { summary: [{ l: 'Campaigns with spend', v: camps.length, f: 'int' }, { l: 'Share of revenue', v: c.rev ? pct(s1, c.rev) : 0, f: 'pct' }], columns: [{ key: 'name', label: 'Campaign', fmt: 'str' }, { key: 'spend', label: 'Spent', fmt: 'money' }, { key: 'share', label: 'Share of spend', fmt: 'pct' }], ...cut(camps.map((x) => ({ name: x.name, spend: x.spend, share: s1 ? pct(x.spend, s1) : null }))) };
    const bNet = { summary: [{ l: 'Profit after ads', v: gp - s1, f: 'money' }, { l: 'Of revenue', v: c.rev ? pct(gp - s1, c.rev) : 0, f: 'pct' }], columns: [{ key: 'step', label: 'Step', fmt: 'str' }, { key: 'amount', label: 'Amount', fmt: 'money' }, { key: 'share', label: 'Of revenue', fmt: 'pct' }],
      rows: [{ step: 'Net revenue', amount: c.rev, share: 100 }, { step: 'Product cost', amount: -c.cost, share: c.rev ? -pct(c.cost, c.rev) : null }, { step: 'Gross profit', amount: gp, share: c.rev ? pct(gp, c.rev) : null }, { step: 'Ad spend (Meta)', amount: -s1, share: c.rev ? -pct(s1, c.rev) : null }, { step: 'Profit after ads', amount: gp - s1, share: c.rev ? pct(gp - s1, c.rev) : null }], more: 0 };
    tiles.push({ label: 'Ad spend (Meta)', value: s1, prev: s0, fmt: 'money', goodDown: true, breakdown: bAds, sub: (c.rev ? pct(s1, c.rev) : 0).toFixed(1) + '% of revenue' });
    tiles.push({ label: 'Profit after ads', value: gp - s1, prev: gp0 - s0, fmt: 'money', breakdown: bNet, sub: (c.rev ? pct(gp - s1, c.rev) : 0).toFixed(1) + '% of revenue' });
    tiles.push({ label: 'Revenue per 1 spent on ads', value: s1 ? c.rev / s1 : 0, prev: s0 ? p.rev / s0 : 0, fmt: 'x', sub: 'net revenue ÷ ad spend, all sales' });
  }
  return tiles;
}
