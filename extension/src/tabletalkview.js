// Drawing the "At the table" stats: one value next to the table average (for the player page and the Playstyles
// table), and a chart of every player on one measure (main page). The numbers come from tabletalk.js.

import { MEASURES } from './tabletalk.js';
import { esc, plural, card } from './ui.js';

export const TALK_SIDES = [['all', 'All games'], ['good', 'As good'], ['evil', 'As evil']];
const sideWords = (side) => (side === 'all' ? '' : `as ${side}`);

// "▲ 0.05 above average (0.35)" / "about average (0.35)". Direction only, in neutral ink: more isn't better or worse.
export function gapLine(id, gap, avg) {
  const m = MEASURES[id];
  if (gap.about) return `about average (${m.fmt(avg)})`;
  return `${gap.d > 0 ? '▲' : '▼'} ${m.gap(Math.abs(gap.d))} ${gap.d > 0 ? 'above' : 'below'} average (${m.fmt(avg)})`;
}

const tipFor = (id, pl, T, side) => {
  const r = pl.rates[id], m = MEASURES[id];
  return `${pl.name}${side === 'all' ? '' : `, ${sideWords(side)}`}\n${m.label}: ${m.fmt(r.value)}\n${m.counts(pl.t)}\n${gapLine(id, r.gap, T.table[id])}`
    + (pl.listed ? '' : `\nFew games (${pl.games}); fewer than ${T.minGames}`) + '\n(pulled slightly toward the average when there\'s little data)';
};

// One cell: the value, and under it how far from the average player it is.
export function talkCell(T, pl, id, side) {
  if (!pl || !pl.t.games || pl.rates[id].value === null) return '<span class="muted">–</span>';
  const r = pl.rates[id], m = MEASURES[id];
  return `<div class="tt-cell" data-tip="${esc(tipFor(id, pl, T, side))}"><b>${m.fmt(r.value)}</b><span class="small">${esc(gapLine(id, r.gap, T.table[id]))}</span>${pl.listed ? '' : '<span class="small muted">few games</span>'}</div>`;
}

// The main page's chart: players on one measure, as a bar from the average (the line) to their value, highest first.
// With many players it shows the top and bottom TOP_N, plus you (your claimed player) and anyone added by hand, with
// a marker for how many players sit between.
// view: { measure, side, added: [keys] }   h: { playerLink, me }
export const TOP_N = 10;

function chartRows(talk, view, h) {
  const T = talk[view.side];
  const id = view.measure;
  const has = (p) => p.rates[id].value !== null;
  const listed = T.players.filter((p) => p.listed && has(p)).sort((a, b) => b.rates[id].value - a.rates[id].value);
  const rank = new Map(listed.map((p, i) => [p.key, i + 1]));
  const extra = new Set([h.me, ...view.added].filter(Boolean));
  const keep = listed.length <= 2 * TOP_N ? listed : listed.filter((p, i) => i < TOP_N || i >= listed.length - TOP_N || extra.has(p.key));
  // You and added players are shown even with few games (marked), in value order.
  const others = T.players.filter((p) => extra.has(p.key) && !rank.has(p.key) && has(p));
  const shown = [...keep, ...others].sort((a, b) => b.rates[id].value - a.rates[id].value);
  return { T, id, listed, rank, shown, extra, added: view.added.filter((k) => T.players.some((p) => p.key === k)) };
}

export function talkChartBody(talk, view, h) {
  const { T, id, listed, rank, shown } = chartRows(talk, view, h);
  const m = MEASURES[id];
  const avg = T.table[id];
  if (avg === null || !shown.length) return '<p class="muted">Not enough games yet.</p>';
  // Symmetric scale around the average (over everyone shown), so left and right read the same.
  const reach = Math.max(...shown.map((p) => Math.abs(p.rates[id].value - avg)), 1e-9) * 1.08;
  const at = (v) => 50 + ((v - avg) / reach) * 50;
  const row = (p) => {
    const r = p.rates[id], x = at(r.value);
    const [l, w] = x >= 50 ? [50, x - 50] : [x, 50 - x];
    const k = rank.get(p.key);
    const me = p.key === h.me;
    return `<div class="tt-row${me ? ' sel' : ''}" data-tip="${esc(tipFor(id, p, T, view.side) + (k ? `\nNumber ${k} of ${listed.length}` : ''))}">
      <div class="name"><span class="rk">${k || ''}</span>${h.playerLink(p.key, p.name)}${me ? ' <span class="tt-tag">you</span>' : ''}${p.listed ? '' : ' <span class="tt-tag muted">few games</span>'}</div>
      <div class="tt-track"><i class="tt-bar ${x >= 50 ? 'up' : 'down'}" style="left:${l.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%"></i><b class="tt-dot" style="left:${x.toFixed(2)}%"></b></div>
      <div class="v"><b>${m.fmt(r.value)}</b> <span class="muted">${r.gap.about ? '±0' : `${r.gap.d > 0 ? '+' : '−'}${m.gap(Math.abs(r.gap.d)).replace(/ pts?$/, '')}`}</span></div>
    </div>`;
  };
  // A marker wherever ranked players are left out between two shown ones (or before the first / after the last).
  const skip = (n) => (n > 0 ? `<div class="tt-row tt-skip"><div></div><div class="tt-track bare"><span>⋯ ${plural(n, 'more player')}</span></div><div></div></div>` : '');
  let html = `<div class="tt-row tt-axis" aria-hidden="true"><div></div><div class="tt-track bare"><span style="left:0">${m.fmt(avg - reach)}</span><span class="avg" style="left:50%">average ${m.fmt(avg)}</span><span style="right:0">${m.fmt(avg + reach)}</span></div><div></div></div>`;
  let last = 0;
  for (const p of shown) {
    const k = rank.get(p.key);
    if (k) { html += skip(k - last - 1); last = k; }
    html += row(p);
  }
  html += skip(listed.length - last);
  return html;
}

// What's shown, in words, under the controls.
export function talkChartNote(talk, view, h) {
  const { T, listed, extra, added } = chartRows(talk, view, h);
  const parts = [];
  if (listed.length > 2 * TOP_N) parts.push(`the top and bottom ${TOP_N} of ${listed.length} players`);
  else parts.push(`all ${plural(listed.length, 'player')}`);
  if (h.me && extra.has(h.me) && T.players.some((p) => p.key === h.me)) parts.push('you');
  const byHand = added.filter((k) => k !== h.me).length;
  if (byHand) parts.push(`${byHand} added`);
  return `Showing ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`;
}

export const talkChartSub = (talk, view) => `Each player next to the average player (the line), for players with ${talk[view.side].minGames}+ games${view.side === 'all' ? '' : ` ${sideWords(view.side)} (only games where they kept one alignment)`}. Only games recorded from the start count. Hover a bar for the counts; click a name for their page.`;

export function talkChartCard(talk, view, h) {
  const select = (attr, options, cur, label) => `<select ${attr} aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const controls = `<div class="tt-controls">${select('data-talk-measure', Object.entries(MEASURES).map(([k, x]) => [k, x.label]), view.measure, 'Measure')}${select('data-talk-side', TALK_SIDES, view.side, 'Games')}<div data-ms-talk></div></div>`;
  return card('At the table', talkChartSub(talk, view), `${controls}<p class="tt-note small muted" id="tt-note">${esc(talkChartNote(talk, view, h))}</p><div class="tt-chart" id="tt-chart">${talkChartBody(talk, view, h)}</div>`, 'wide tt-chart-card');
}
