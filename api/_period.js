import { HttpError } from './_lib.js';

/**
 * One date model shared by the Shopify, Meta Ads and Odoo pages.
 *
 * Query: from, to            the period being looked at (YYYY-MM-DD, both days included)
 *        cfrom, cto          optional custom period to compare with
 * Without cfrom/cto the comparison is the automatic "previous" period:
 *   whole month  -> previous month, same number of days
 *   whole quarter -> previous quarter, same number of days
 *   anything else (a day, a week, a custom range) -> the same number of days straight before it.
 */
export const MAX_DAYS = 400;
const RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export const isDate = (s) => typeof s === 'string' && RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const ms = (s) => Date.parse(s + 'T00:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => iso(ms(s) + n * DAY);
export const diffDays = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const monthEnd = (y, m) => iso(Date.UTC(y, m, 0));   // m is 1-12, day 0 of the next month
const ymOf = (s) => [Number(s.slice(0, 4)), Number(s.slice(5, 7))];

export const todayIn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz });

const fmt = (s, withYear = true) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const monthName = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** What kind of period is this? Used for the label and to pick the automatic comparison. */
function shape(from, to, today, hint) {
  const [fy, fm] = ymOf(from), [ty, tm] = ymOf(to);
  // On the 1st, "this month so far" is a single day; the date bar says which one was meant.
  if (from === to && hint === 'month' && from.endsWith('-01')) return { kind: 'month', full: false };
  if (from === to && hint === 'quarter' && from.endsWith('-01') && [1, 4, 7, 10].includes(fm)) return { kind: 'quarter', full: false };
  if (from === to) return { kind: 'day' };
  if (fy === ty && fm === tm && from.endsWith('-01')) {
    const end = monthEnd(fy, fm);
    if (to === end || (to === today && today < end)) return { kind: 'month', full: to === end };
  }
  if (from.endsWith('-01') && [1, 4, 7, 10].includes(fm)) {
    const qEnd = monthEnd(fy, fm + 2);
    if ((to === qEnd || (to === today && today < qEnd)) && ty === fy && tm <= fm + 2 && tm >= fm) return { kind: 'quarter', full: to === qEnd };
  }
  return { kind: 'range' };
}

export function labelOf(from, to, today, hint) {
  const sh = shape(from, to, today, hint);
  if (sh.kind === 'day') return fmt(from);
  if (sh.kind === 'month') return sh.full ? monthName(from) : `${new Date(from + 'T12:00:00Z').getUTCDate()}–${fmt(to)}`;
  if (sh.kind === 'quarter') {
    const q = Math.floor((ymOf(from)[1] - 1) / 3) + 1;
    return `Q${q} ${from.slice(0, 4)}` + (sh.full ? '' : ` (to ${fmt(to, false)})`);
  }
  return from.slice(0, 4) === to.slice(0, 4) ? `${fmt(from, false)} – ${fmt(to)}` : `${fmt(from)} – ${fmt(to)}`;
}

/** The automatic comparison: the period just before this one. */
export function previousOf(from, to, today, hint) {
  const sh = shape(from, to, today, hint);
  const days = diffDays(from, to) + 1;
  if (sh.kind === 'month') {
    const [y, m] = ymOf(from);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const pStart = `${py}-${pad(pm)}-01`, pEnd = monthEnd(py, pm);
    const wanted = addDays(pStart, days - 1);
    return { from: pStart, to: sh.full ? pEnd : (wanted > pEnd ? pEnd : wanted), kind: 'month' };
  }
  if (sh.kind === 'quarter') {
    const [y, m] = ymOf(from);
    const pm0 = m - 3, py = pm0 < 1 ? y - 1 : y, pm = pm0 < 1 ? pm0 + 12 : pm0;
    const pStart = `${py}-${pad(pm)}-01`, pEnd = monthEnd(py, pm + 2);
    const wanted = addDays(pStart, days - 1);
    return { from: pStart, to: sh.full ? pEnd : (wanted > pEnd ? pEnd : wanted), kind: 'quarter' };
  }
  const cto = addDays(from, -1);
  return { from: addDays(cto, -(days - 1)), to: cto, kind: sh.kind === 'day' ? 'day' : 'range' };
}

/** Validates a from/to pair and returns the end date cut at today. */
function check(from, to, today, what) {
  if (from > today) throw new HttpError(400, `${what}: that period has not started yet.`);
  const end = to > today ? today : to;
  if (from > end) throw new HttpError(400, `${what}: the start date is after the end date.`);
  if (diffDays(from, end) + 1 > MAX_DAYS) throw new HttpError(400, `${what}: choose at most ${MAX_DAYS} days.`);
  return end;
}

/**
 * Reads the period from the query string. Returns null when no from/to were sent, so the caller can fall back to
 * the older "month" parameter.
 */
export function parsePeriod(query, tz) {
  const q = query || {};
  if (q.from === undefined && q.to === undefined) return null;
  const today = todayIn(tz);
  if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Choose valid start and end dates.');
  const hint = ['day', 'month', 'quarter'].includes(q.kind) ? q.kind : '';
  const from = q.from;
  const to = check(from, q.to, today, 'Period');
  const clamped = to !== q.to;
  const period = { from, to, days: diffDays(from, to) + 1, label: labelOf(from, to, today, hint), clamped, today, kind: hint || shape(from, to, today).kind };

  let cmp;
  const hasC = q.cfrom !== undefined || q.cto !== undefined;
  if (hasC) {
    if (!isDate(q.cfrom) || !isDate(q.cto)) throw new HttpError(400, 'Choose valid start and end dates to compare with.');
    const cto = check(q.cfrom, q.cto, today, 'Comparison');
    cmp = { from: q.cfrom, to: cto, custom: true, kind: 'custom' };
  } else {
    cmp = { ...previousOf(from, to, today, hint), custom: false };
  }
  cmp.days = diffDays(cmp.from, cmp.to) + 1;
  cmp.label = labelOf(cmp.from, cmp.to, today);
  period.compare = cmp;
  period.compareText = cmp.custom ? cmp.label : cmp.kind === 'month' ? 'previous month' : cmp.kind === 'quarter' ? 'previous quarter' : cmp.kind === 'day' ? 'previous day' : 'previous period';
  return period;
}

/** The whole calendar month a plain month key stands for, as a period (this month stops at today). */
export function monthPeriod(key, tz) {
  const today = todayIn(tz);
  const [y, m] = ymOf(key + '-01');
  const end = monthEnd(y, m);
  return parsePeriod({ from: `${key}-01`, to: end > today ? today : end }, tz);
}

/** Month keys (YYYY-MM) a period touches, oldest first. */
export function monthsIn(from, to) {
  const out = [];
  let [y, m] = ymOf(from);
  const [ey, em] = ymOf(to);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/* ---------- time zones (the dashboard day starts at local midnight) ---------- */
function offsetMs(t, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
/** Milliseconds at local midnight of the given day. */
export function startMs(dateStr, tz) {
  const guess = Date.parse(dateStr + 'T00:00:00Z');
  let t = guess - offsetMs(guess, tz);
  const o2 = offsetMs(t, tz);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}
/** Milliseconds at the start of the day after `to`, so [startMs(from), endMs(to)) covers both days fully. */
export const endMs = (dateStr, tz) => startMs(addDays(dateStr, 1), tz);
