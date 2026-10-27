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

// Every listed player on one measure: a bar from the average to their value (right = above, left = below), sorted.
// h: { playerLink, selected }
export function talkChartCard(talk, id, side, h) {
  const T = talk[side];
  const m = MEASURES[id];
  const avg = T.table[id];
  const rows = T.players.filter((p) => p.listed && p.rates[id].value !== null).sort((a, b) => b.rates[id].value - a.rates[id].value);
  const select = (attr, options, cur, label) => `<select ${attr} aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const controls = `<div class="tt-controls">${select('data-talk-measure', Object.entries(MEASURES).map(([k, x]) => [k, x.label]), id, 'Measure')}${select('data-talk-side', TALK_SIDES, side, 'Games')}</div>`;
  const sub = `Each player next to the average player (the line), for players with ${T.minGames}+ games${side === 'all' ? '' : ` ${sideWords(side)} (only games where they kept one alignment)`}. Only games recorded from the start count. Hover a bar for the counts; click a name for their page.`;
  if (avg === null || !rows.length) return card('At the table', sub, `${controls}<p class="muted">Not enough games yet.</p>`, 'wide tt-chart-card');
  // Symmetric scale around the average, so left and right read the same.
  const reach = Math.max(...rows.map((p) => Math.abs(p.rates[id].value - avg)), 1e-9) * 1.08;
  const at = (v) => 50 + ((v - avg) / reach) * 50;
  const body = rows.map((p) => {
    const r = p.rates[id], x = at(r.value);
    const [l, w] = x >= 50 ? [50, x - 50] : [x, 50 - x];
    const sel = h.selected.includes(p.key);
    return `<div class="tt-row${sel ? ' sel' : ''}" data-tip="${esc(tipFor(id, p, T, side))}">
      <div class="name">${h.playerLink(p.key, p.name)}</div>
      <div class="tt-track"><i class="tt-bar ${x >= 50 ? 'up' : 'down'}" style="left:${l.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%"></i><b class="tt-dot" style="left:${x.toFixed(2)}%"></b></div>
      <div class="v"><b>${m.fmt(r.value)}</b> <span class="muted">${r.gap.about ? '±0' : `${r.gap.d > 0 ? '+' : '−'}${m.gap(Math.abs(r.gap.d)).replace(/ pts?$/, '')}`}</span></div>
    </div>`;
  }).join('');
  const head = `<div class="tt-row tt-axis" aria-hidden="true"><div></div><div class="tt-track bare"><span style="left:0">${m.fmt(avg - reach)}</span><span class="avg" style="left:50%">average ${m.fmt(avg)}</span><span style="right:0">${m.fmt(avg + reach)}</span></div><div></div></div>`;
  return card('At the table', sub, `${controls}<div class="tt-chart" role="img" aria-label="${esc(`${m.label}${side === 'all' ? '' : `, ${sideWords(side)}`}, ${plural(rows.length, 'player')} against an average of ${m.fmt(avg)}`)}">${head}${body}</div>`, 'wide tt-chart-card');
}
