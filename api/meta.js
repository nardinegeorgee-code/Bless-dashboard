import { route, allow, db, HttpError, requireAdmin } from './_lib.js';
import { ensureShopSchema } from './_shopify.js';
import { metaConfig, graph, graphAll, cached, clearMetaCache, audit, recentAudit, accountInfo, metrics, INSIGHT_FIELDS, ACCOUNT_STATUS, budgetOffset } from './_meta.js';

const DAY = 86400000;
const TABS = ['overview', 'campaigns'];
const pad = (n) => String(n).padStart(2, '0');
const label = (key) => new Date(key + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const range = (key) => { const [y, m] = key.split('-').map(Number); return { s: `${key}-01`, e: `${key}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }; };
const prevKey = (key) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };

function monthKeyer(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  return (ms) => { const p = f.formatToParts(new Date(ms)); return p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value; };
}
function lastMonths(keyOf, n) {
  const [y, m] = keyOf(Date.now()).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); });
}

/** A section never throws: a failed query becomes an error card so the rest of the tab still loads. */
const section = (id, title, kind, fn, note) => async () => {
  try { return { id, title, kind, note, ...(await fn()) }; }
  catch (e) { return { id, title, kind, note, error: String(e.message || e).slice(0, 400) }; }
};
const tile = (label, value, fmt, extra = {}) => ({ label, value, fmt, ...extra });
async function pool(tasks, size = 3) {
  const out = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

/* ---------- insights (all cached for 15 minutes; "Refresh numbers" skips the cache) ---------- */
const timeRange = (s, e) => ({ since: s, until: e });
const insights = (cfg, key, refresh, params) => cached(cfg, 'ins|' + key, refresh, () => graphAll(cfg, 'act_' + cfg.account + '/insights', { fields: INSIGHT_FIELDS, limit: 200, ...params }));

const monthlySeries = (cfg, ctx) => ctx.once('monthly', async () => {
  const rows = await insights(cfg, `monthly|${ctx.months[0]}|${ctx.untilAll}`, ctx.refresh, { level: 'account', time_increment: 'monthly', time_range: timeRange(ctx.months[0] + '-01', ctx.untilAll) });
  const by = new Map(rows.map((r) => [String(r.date_start).slice(0, 7), metrics(r)]));
  return ctx.months.map((k) => ({ key: k, label: label(k), m: by.get(k) || metrics(null), has: by.has(k) }));
});
const campaignInsights = (cfg, ctx) => ctx.once('campIns', () => insights(cfg, `camp|${ctx.s}|${ctx.until}`, ctx.refresh, { level: 'campaign', fields: INSIGHT_FIELDS + ',campaign_id,campaign_name', time_range: timeRange(ctx.s, ctx.until) }));

/** Shopify revenue for the month, from the orders already synced into the database. Null when those orders do not cover the month. */
async function shopifyMonth(cfg, ctx) {
  await ensureShopSchema();
  const q = db();
  const [y, m] = ctx.month.split('-').map(Number);
  const first = await q`SELECT MIN(created_at) AS t FROM shop_orders`;
  if (!first[0] || first[0].t === null || Number(first[0].t) > Date.UTC(y, m - 1, 1) + 3 * DAY) return null;
  const rows = await q`SELECT created_at, total, cancelled, currency FROM shop_orders WHERE created_at >= ${Date.UTC(y, m - 1, 1) - 2 * DAY} AND created_at < ${Date.UTC(y, m, 1) + 2 * DAY}`;
  const mine = rows.filter((o) => !o.cancelled && ctx.keyOf(Number(o.created_at)) === ctx.month);
  return { revenue: mine.reduce((a, o) => a + Number(o.total), 0), orders: mine.length, currency: (mine.find((o) => o.currency) || {}).currency || '' };
}

/* ---------- tabs ---------- */
function build(tab, cfg, ctx, info) {
  if (tab === 'overview') return [
    section('kpi', `Meta ads in ${ctx.monthLabel}`, 'kpi', async () => {
      const series = await monthlySeries(cfg, ctx);
      const cur = (series.find((x) => x.key === ctx.month) || {}).m || metrics(null);
      const prv = (series.find((x) => x.key === ctx.prev) || {}).m;
      const p = (k) => (prv ? { prev: prv[k] } : {});
      const tiles = [
        tile('Amount spent', cur.spend, 'money', p('spend')),
        tile('Purchases', cur.purchases, 'int', p('purchases')),
        tile('Purchase value', cur.value, 'money', p('value')),
        tile('Return on ad spend', cur.roas, 'x', { ...p('roas'), sub: 'purchase value ÷ spend, as Meta reports it' }),
        tile('Cost per purchase', cur.cpp, 'money2', { ...p('cpp'), goodDown: true }),
        tile('People reached', cur.reach, 'int', p('reach')),
        tile('Impressions', cur.impressions, 'int', p('impressions')),
        tile('Link clicks', cur.clicks, 'int', p('clicks')),
        tile('Link click rate', cur.ctr, 'pct', p('ctr')),
        tile('Cost per link click', cur.cpc, 'money2', { ...p('cpc'), goodDown: true }),
        tile('Cost per 1,000 views', cur.cpm, 'money2', { ...p('cpm'), goodDown: true }),
      ];
      if (cur.messages > 0) tiles.push(tile('Chats started', cur.messages, 'int', p('messages')));
      return { tiles };
    }, 'Numbers come from Meta with its default attribution window. Meta and Shopify never agree exactly; the next card compares them.'),
    section('trend', 'Last 12 months', 'trend', async () => {
      const series = await monthlySeries(cfg, ctx);
      return {
        metrics: [{ key: 'spend', label: 'Amount spent', fmt: 'money' }, { key: 'purchases', label: 'Purchases', fmt: 'int' }, { key: 'value', label: 'Purchase value', fmt: 'money' }, { key: 'roas', label: 'Return on ad spend', fmt: 'x' }, { key: 'cpp', label: 'Cost per purchase', fmt: 'money2' }, { key: 'clicks', label: 'Link clicks', fmt: 'int' }],
        rows: series.map((x) => ({ key: x.key, label: x.label, values: { spend: x.m.spend, purchases: x.m.purchases, value: x.m.value, roas: x.m.roas, cpp: x.m.cpp, clicks: x.m.clicks } })),
      };
    }),
    section('blend', 'Meta spend vs your real Shopify sales', 'kpi', async () => {
      const series = await monthlySeries(cfg, ctx);
      const cur = (series.find((x) => x.key === ctx.month) || {}).m || metrics(null);
      const shop = await shopifyMonth(cfg, ctx);
      if (!shop) return { kind: 'text', items: ['Your synced Shopify orders do not go back to this month, so the comparison is hidden. Pick a recent month, or press Sync now on the Shopify page.'] };
      if (shop.currency && info.currency && shop.currency !== info.currency) return { kind: 'text', items: [`Your Shopify store sells in ${shop.currency} but the Meta ad account bills in ${info.currency}, so the two cannot be compared without a conversion.`] };
      return { tiles: [
        tile('Shopify revenue', shop.revenue, 'money', { sub: shop.orders + ' orders, from all sources' }),
        tile('Meta spend', cur.spend, 'money'),
        tile('Blended return', cur.spend ? shop.revenue / cur.spend : 0, 'x', { sub: 'all Shopify revenue ÷ Meta spend' }),
        tile('Meta says it drove', shop.revenue ? (cur.value / shop.revenue) * 100 : 0, 'pct', { sub: 'of Shopify revenue (Meta purchase value)' }),
        tile('Ad spend per Shopify order', shop.orders ? cur.spend / shop.orders : 0, 'money2', { goodDown: true }),
      ] };
    }, 'Blended return counts every sale, including ones that did not come from ads, so it is a sanity check rather than a precise result.'),
    section('campaigns', 'Campaigns by spend', 'table', async () => {
      const rows = (await campaignInsights(cfg, ctx)).map((r) => ({ name: r.campaign_name || 'Unnamed campaign', ...metrics(r) })).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 10);
      return { columns: [{ key: 'name', label: 'Campaign', fmt: 'str' }, { key: 'spend', label: 'Spent', fmt: 'money', bar: true }, { key: 'purchases', label: 'Purchases', fmt: 'int' }, { key: 'roas', label: 'Return', fmt: 'x' }, { key: 'cpp', label: 'Per purchase', fmt: 'money2' }], rows, empty: 'No campaign spent anything this month.' };
    }),
    section('ads', 'Ads by spend', 'table', async () => {
      const raw = await insights(cfg, `ad|${ctx.s}|${ctx.until}`, ctx.refresh, { level: 'ad', fields: INSIGHT_FIELDS + ',ad_name,campaign_name', time_range: timeRange(ctx.s, ctx.until), limit: 500 });
      const rows = raw.map((r) => ({ name: (r.ad_name || 'Unnamed ad') + (r.campaign_name ? ' · ' + r.campaign_name : ''), ...metrics(r) })).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 10);
      return { columns: [{ key: 'name', label: 'Ad', fmt: 'str' }, { key: 'spend', label: 'Spent', fmt: 'money', bar: true }, { key: 'purchases', label: 'Purchases', fmt: 'int' }, { key: 'roas', label: 'Return', fmt: 'x' }, { key: 'ctr', label: 'Click rate', fmt: 'pct' }], rows, empty: 'No ad spent anything this month.' };
    }, 'Useful for the Graphic Designer and Media Buyer: which creative is earning its spend.'),
    section('platform', 'Where the money went', 'table', async () => {
      const raw = await insights(cfg, `plat|${ctx.s}|${ctx.until}`, ctx.refresh, { level: 'account', breakdowns: 'publisher_platform', time_range: timeRange(ctx.s, ctx.until) });
      const name = { facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network', messenger: 'Messenger', whatsapp: 'WhatsApp', threads: 'Threads' };
      const rows = raw.map((r) => ({ name: name[r.publisher_platform] || r.publisher_platform || 'Other', ...metrics(r) })).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
      return { columns: [{ key: 'name', label: 'Platform', fmt: 'str' }, { key: 'spend', label: 'Spent', fmt: 'money', bar: true }, { key: 'impressions', label: 'Impressions', fmt: 'int' }, { key: 'purchases', label: 'Purchases', fmt: 'int' }, { key: 'roas', label: 'Return', fmt: 'x' }], rows, empty: 'Nothing was spent this month.' };
    }),
  ];

  if (tab === 'campaigns') return [
    section('list', 'Your campaigns', 'campaigns', async () => {
      const [list, ins] = await Promise.all([
        cached(cfg, 'campaigns', ctx.refresh, () => graphAll(cfg, 'act_' + cfg.account + '/campaigns', { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', limit: 100 })),
        campaignInsights(cfg, ctx),
      ]);
      const by = new Map(ins.map((r) => [r.campaign_id, metrics(r)]));
      const off = budgetOffset(info.currency);
      const rows = list.map((c) => {
        const m = by.get(c.id) || metrics(null);
        const eff = String(c.effective_status || c.status || '');
        return {
          id: c.id, name: c.name || 'Unnamed campaign', status: c.status, effective: eff, objective: String(c.objective || '').replace(/^OUTCOME_/, '').replace(/_/g, ' ').toLowerCase(),
          dailyBudget: c.daily_budget ? Number(c.daily_budget) / off : null, lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / off : null,
          canToggle: c.status === 'ACTIVE' || c.status === 'PAUSED', ...m,
        };
      }).filter((r) => r.status !== 'DELETED' && (r.status !== 'ARCHIVED' || r.spend > 0))
        .sort((a, b) => (b.status === 'ACTIVE') - (a.status === 'ACTIVE') || b.spend - a.spend);
      return { rows, empty: 'This ad account has no campaigns yet.' };
    }, 'Pause, resume or change the daily budget. Every change is written to the log below. Spend and results are for the month chosen above.'),
    section('audit', 'Changes made from this dashboard', 'table', async () => {
      const log = await recentAudit(15);
      const rows = log.map((a) => {
        const d = a.detail || {};
        const what = a.action === 'status' ? (d.to === 'PAUSED' ? 'Paused' : 'Resumed') : `Daily budget ${d.from ?? '?'} → ${d.to}`;
        return { when: new Date(Number(a.created_at)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC', who: a.username, what, name: a.object_name || a.object_id };
      });
      return { columns: [{ key: 'name', label: 'Campaign', fmt: 'str' }, { key: 'what', label: 'Change', fmt: 'str' }, { key: 'who', label: 'By', fmt: 'str' }, { key: 'when', label: 'When', fmt: 'str' }], rows, empty: 'Nothing has been changed from here yet.' };
    }),
  ];
  return [];
}

/* ---------- changing campaigns ---------- */
async function write(req, res, cfg, user) {
  if (cfg.missing.length) throw new HttpError(400, 'Meta Ads is not connected yet.');
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  const id = String(b.id || '');
  if (!/^\d{5,25}$/.test(id)) throw new HttpError(400, 'That is not a campaign id.');
  const obj = await graph(cfg, 'GET', id, { fields: 'account_id,name,status,objective,daily_budget,lifetime_budget' });
  if (String(obj.account_id || '').replace(/\D/g, '') !== cfg.account) throw new HttpError(403, 'That campaign does not belong to the connected ad account.');
  if (!obj.objective) throw new HttpError(400, 'Only campaigns can be changed from here.');

  if (b.action === 'status') {
    const to = b.status;
    if (to !== 'ACTIVE' && to !== 'PAUSED') throw new HttpError(400, 'Status must be ACTIVE or PAUSED.');
    if (obj.status !== 'ACTIVE' && obj.status !== 'PAUSED') throw new HttpError(400, `This campaign is ${String(obj.status).toLowerCase()} and cannot be switched here.`);
    if (obj.status === to) return res.json({ ok: true, unchanged: true, status: to });
    await graph(cfg, 'POST', id, { status: to });
    await audit(user, 'status', id, obj.name, { from: obj.status, to });
    await clearMetaCache();
    return res.json({ ok: true, status: to });
  }

  if (b.action === 'budget') {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter a daily budget above zero.');
    if (!obj.daily_budget) throw new HttpError(400, obj.lifetime_budget ? 'This campaign uses a lifetime budget, which cannot be changed here.' : 'This campaign sets its budget on each ad set, so it has no campaign budget to change here.');
    const info = await accountInfo(cfg, false);
    const off = budgetOffset(info.currency);
    const current = Number(obj.daily_budget) / off;
    if (amount > current * 10) throw new HttpError(400, `That is more than 10 times the current daily budget (${current}). If you really want this, raise it in smaller steps.`);
    const minor = Math.round(amount * off);
    if (minor === Number(obj.daily_budget)) return res.json({ ok: true, unchanged: true, dailyBudget: current });
    await graph(cfg, 'POST', id, { daily_budget: minor });
    await audit(user, 'budget', id, obj.name, { from: current, to: minor / off, currency: info.currency });
    await clearMetaCache();
    return res.json({ ok: true, dailyBudget: minor / off });
  }
  throw new HttpError(400, 'Unknown action.');
}

export default route(async (req, res) => {
  allow(req, ['GET', 'POST']);
  const user = await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  const cfg = metaConfig();
  if (req.method === 'POST') return write(req, res, cfg, user);
  if (cfg.missing.length) return res.json({ configured: false, missing: cfg.missing });

  const keyOf = monthKeyer(cfg.tz);
  const months = lastMonths(keyOf, 12);
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'overview';
  const month = months.includes(req.query.month) ? req.query.month : months[months.length - 1];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: cfg.tz });
  const { s, e } = range(month);
  const memo = {};
  const ctx = {
    month, monthLabel: label(month), prev: prevKey(month), s, until: e < today ? e : today, months, keyOf, refresh: req.query.refresh === '1',
    untilAll: range(months[months.length - 1]).e < today ? range(months[months.length - 1]).e : today,
    once: (k, fn) => (memo[k] = memo[k] || fn()),
  };
  const info = await accountInfo(cfg, ctx.refresh);
  const sections = await pool(build(tab, cfg, ctx, info), 3);
  res.json({
    configured: true, tab, month, monthLabel: ctx.monthLabel, months: months.map((k) => ({ key: k, label: label(k) })),
    currency: info.currency, account: info.name, accountStatus: ACCOUNT_STATUS[info.status] || 'Unknown', timezone: info.timezone, sections,
  });
});
