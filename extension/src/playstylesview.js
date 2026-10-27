// The Playstyles tab: how each player's games end, a map of who plays alike, the named groups, and who leads the
// table to the other team. The numbers come from playstyles.js; this file only draws them.

import { playstyles, FATES } from './playstyles.js';
import { esc, pct, plural, card, tile } from './ui.js';

export const STYLE_SIDES = [['good', 'As good'], ['evil', 'As evil'], ['all', 'All games']];
const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
const SHAPE_WORD = { circle: '●', square: '■', triangle: '▲', diamond: '◆' };

// One marker. (x, y) is its centre; r its rough radius.
function marker(shape, x, y, r, attrs) {
  const f = (n) => n.toFixed(1);
  if (shape === 'square') return `<rect x="${f(x - r * 0.88)}" y="${f(y - r * 0.88)}" width="${f(r * 1.76)}" height="${f(r * 1.76)}" rx="2" ${attrs}/>`;
  if (shape === 'triangle') return `<path d="M${f(x)},${f(y - r * 1.15)} L${f(x + r * 1.05)},${f(y + r * 0.75)} L${f(x - r * 1.05)},${f(y + r * 0.75)} Z" stroke-linejoin="round" ${attrs}/>`;
  if (shape === 'diamond') return `<path d="M${f(x)},${f(y - r * 1.2)} L${f(x + r * 1.2)},${f(y)} L${f(x)},${f(y + r * 1.2)} L${f(x - r * 1.2)},${f(y)} Z" stroke-linejoin="round" ${attrs}/>`;
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" ${attrs}/>`;
}
const glyph = (i) => `<svg class="ps-glyph" viewBox="0 0 16 16" aria-hidden="true">${marker(SHAPES[i], 8, 8.5, 5.6, `class="ps-g${i}"`)}</svg>`;

const fmtValue = (tr) => (tr.pct ? pct(tr.group) : tr.group.toFixed(2));
const fmtEveryone = (tr) => (tr.pct ? pct(tr.everyone) : tr.everyone.toFixed(2));
const traitWords = (tr) => `${tr.label}: ${fmtValue(tr)} (everyone: ${fmtEveryone(tr)})`;

// ---------- the map ----------
function mapSvg(R, selected) {
  const W = 680, H = 420, padL = 26, padR = 26, padT = 30, padB = 34;
  const xs = R.players.map((p) => p.xy[0]), ys = R.players.map((p) => p.xy[1]);
  const span = (v) => { const lo = Math.min(...v), hi = Math.max(...v), m = (hi - lo) * 0.08 || 1; return [lo - m, hi + m]; };
  const [x0, x1] = span(xs), [y0, y1] = span(ys);
  const sx = (v) => padL + ((v - x0) / (x1 - x0)) * (W - padL - padR);
  const sy = (v) => H - padB - ((v - y0) / (y1 - y0)) * (H - padT - padB);
  const words = (list) => `more ${list.map((a) => a.label).join(', ')}`;
  const ax = R.axes;
  // The average player sits at (0, 0): dashed cross-hairs there.
  let svg = `<line class="ps-zero" x1="${sx(0).toFixed(1)}" x2="${sx(0).toFixed(1)}" y1="${padT}" y2="${H - padB}"/><line class="ps-zero" x1="${padL}" x2="${W - padR}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}"/>`;
  svg += `<text class="ps-avg" x="${W - padR}" y="${(sy(0) - 5).toFixed(1)}" text-anchor="end">average player</text>`;
  // What each direction means, from the rates that move it most.
  // Each axis end names the rates that push a player that way (y: top and bottom of the left edge; x: bottom corners).
  if (ax[1].pos.length) svg += `<text class="ps-axis" x="${padL}" y="16">↑ ${esc(words(ax[1].pos))}</text>`;
  if (ax[1].neg.length) svg += `<text class="ps-axis" x="${W - padR}" y="16" text-anchor="end">↓ ${esc(words(ax[1].neg))}</text>`;
  if (ax[0].neg.length) svg += `<text class="ps-axis" x="${padL}" y="${H - 10}">← ${esc(words(ax[0].neg))}</text>`;
  if (ax[0].pos.length) svg += `<text class="ps-axis" x="${W - padR}" y="${H - 10}" text-anchor="end">${esc(words(ax[0].pos))} →</text>`;
  // Selected players last, so they sit on top; their names always show.
  const pts = R.players.map((p) => ({ p, x: sx(p.xy[0]), y: sy(p.xy[1]), sel: selected.includes(p.key) }))
    .sort((a, b) => a.sel - b.sel);
  const boxes = pts.map((q) => ({ x0: q.x - 7, x1: q.x + 7, y0: q.y - 7, y1: q.y + 7 })); // the markers themselves
  const hits = (b) => b.x0 < padL - 4 || b.x1 > W - padR + 4 || b.y0 < padT - 8 || b.y1 > H - padB + 4 || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  let marks = '', labels = '';
  const order = [...pts].sort((a, b) => b.sel - a.sel || b.p.games - a.p.games); // label the most-played first
  for (const q of order) {
    const w = [...q.p.name].length * (q.sel ? 6.9 : 6.3) + 2;
    const tries = [[q.x + 10, q.y + 4, 'start'], [q.x - 10, q.y + 4, 'end'], [q.x, q.y - 12, 'middle'], [q.x, q.y + 19, 'middle']];
    for (const [tx, ty, anchor] of tries) {
      const bx = anchor === 'start' ? tx : anchor === 'end' ? tx - w : tx - w / 2;
      const b = { x0: bx, x1: bx + w, y0: ty - 10, y1: ty + 3 };
      if (!q.sel && hits(b)) continue;
      boxes.push(b);
      labels += `<text class="ps-label${q.sel ? ' sel' : ''}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${esc(q.p.name)}</text>`;
      break;
    }
  }
  for (const q of pts) {
    const g = R.groups[q.p.group];
    const top = Object.entries(q.p.z).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
      .map(([id]) => { const v = q.p.values[id]; const tr = g.traits.find((t) => t.id === id); return `${tr.label}: ${tr.pct ? pct(v.raw) : (v.raw ?? 0).toFixed(2)}`; });
    const tip = `${q.p.name} · ${g.name}\n${plural(q.p.games, 'game')}\n${top.join('\n')}`;
    if (q.sel) marks += `<circle class="ps-ring" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="12"/>`;
    marks += `<g data-add-player="${esc(q.p.key)}" class="ps-pt" data-tip="${esc(tip)}"><circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="13" fill="transparent"/>${marker(SHAPES[q.p.group], q.x, q.y, q.sel ? 7.5 : 6.2, `class="ps-g${q.p.group}"`)}</g>`;
  }
  const aria = `Map of ${R.players.length} players grouped into ${R.groups.length} playstyles: ${R.groups.map((g) => `${g.name} (${g.members.length})`).join(', ')}`;
  return `<svg class="ps-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${svg}${marks}${labels}</svg>`;
}

const clarity = (s) => (s >= 0.5 ? 'clearly apart' : s >= 0.25 ? 'somewhat apart' : 'loosely apart — read them as tendencies, not types');

function groupLegend(R) {
  return `<div class="legend ps-legend">${R.groups.map((g, i) => `<span>${glyph(i)}${esc(g.name)} <span class="muted">${g.members.length}</span></span>`).join('')}</div>`;
}

function groupCard(R, g, playerLink) {
  const rows = g.standout.length ? g.standout : g.traits.slice(0, 2);
  const body = `<table class="rows ps-traits"><tbody>${rows.map((tr) => {
    const up = tr.z > 0;
    return `<tr data-tip="${esc(`${traitWords(tr)}\n${Math.abs(tr.z).toFixed(1)} spreads ${up ? 'above' : 'below'} the average player`)}"><td>${esc(tr.short[0].toUpperCase() + tr.short.slice(1))}</td><td class="num"><b>${fmtValue(tr)}</b></td><td class="num muted nowrap">vs. ${fmtEveryone(tr)}</td><td class="num"><span class="delta ${up ? 'up' : 'down'} ps-dir">${up ? '▲ more' : '▼ less'}</span></td></tr>`;
  }).join('')}</tbody></table>`;
  const who = `<p class="ps-members">${g.members.map((m) => playerLink(m.key, m.name)).join(', ')}</p>`;
  const quiet = !g.standout.length ? '<p class="muted small">Nothing sets this group far apart: these players sit close to the table average, leaning slightly this way.</p>' : '';
  return card(`${glyph(g.index)} ${esc(g.name)}`, `${plural(g.members.length, 'player')} · what sets them apart from everyone`, body + quiet + who, 'ps-group');
}

// ---------- how games end ----------
function fateLegend() {
  return `<div class="legend ps-fates-legend">${FATES.map((f, i) => `<span data-tip="${esc(f.tip)}"><i class="sw ps-f${i}"></i>${esc(f.label)}</span>`).join('')}</div>`;
}
function fateBar(fates, known, label, n, tipName) {
  if (!known) return '';
  const segs = FATES.map((f, i) => {
    const c = fates[f.id];
    if (!c) return '';
    const share = c / known;
    return `<div class="ps-f${i}" style="flex:${share}" data-tip="${esc(`${tipName}\n${f.label}: ${c} of ${plural(known, 'game')} (${pct(share)})`)}">${share >= 0.16 ? pct(share) : ''}</div>`;
  }).join('');
  return `<div class="split-row ps-row"><div class="name">${label}</div><div class="split ps-split">${segs}</div><div class="n">${n}</div></div>`;
}
function fatesCard(R, playerLink, sideWord) {
  const rows = (list) => list
    .map((p) => ({ p, early: (p.t.fates.killedEarly + p.t.fates.execEarly) / (p.t.known || 1) }))
    .sort((a, b) => b.early - a.early || b.p.games - a.p.games)
    .map(({ p }) => fateBar(p.t.fates, p.t.known, playerLink(p.key, p.name), plural(p.games, 'game'), `${p.name}${sideWord ? ` ${sideWord}` : ''}`)).join('');
  const everyone = fateBar(R.pooled.fates, R.pooled.known, '<b>Everyone</b>', plural(R.pooled.games, 'seat'), `Every player${sideWord ? ` ${sideWord}` : ''}`);
  let body = `${fateLegend()}<div class="ps-bars">${everyone}`;
  if (R.groups.length) {
    for (const g of R.groups) body += `<div class="ps-gh">${glyph(g.index)}<b>${esc(g.name)}</b></div>${rows(g.members)}`;
  } else body += rows(R.players);
  body += '</div>';
  const unknown = R.pooled.games - R.pooled.known;
  const note = unknown ? `<p class="muted small">${plural(unknown, 'seat')} left out where the player died before anyone was recording.</p>` : '';
  return card(`How their games end${sideWord ? ` ${sideWord}` : ''}`, 'Each player\'s fate in every game, early exits first. "Early" means by the end of Day 2. Hover a segment for the count.', body + note, 'wide');
}

// ---------- nominations ----------
function nominationsCard(R, h) {
  const side = R.side;
  const title = side === 'good' ? 'Hound dogs' : side === 'evil' ? 'Framers' : 'Who gets the other team executed';
  const sub = side === 'good'
    ? 'How often their nominations land on evil players and get them executed. Only games recorded from the start count.'
    : side === 'evil' ? 'How often their nominations get good players executed. Only games recorded from the start count.'
      : 'How often their nominations get a player from the other team executed. Only games recorded from the start count.';
  const rows = R.players.filter((p) => p.t.tracked).map((p) => ({ key: p.key, name: p.name, tracked: p.t.tracked, noms: p.t.noms / p.t.tracked,
    onEvil: p.t.noms ? p.t.nomsOnEvil / p.t.noms : null, nomsN: p.t.noms, execs: p.t.enemyExecs, perGame: p.t.enemyExecs / p.t.tracked,
    votesEvil: p.t.votes ? p.t.votesOnEvil / p.t.votes : null, votes: p.t.votes }));
  const cols = [
    h.colPlayer(),
    h.colNum('Games', (r) => r.tracked),
    { ...h.colNum('Nominations per game', (r) => r.noms), cell: (r) => `<td class="num">${r.noms.toFixed(2)}</td>` },
    ...(side === 'good' ? [h.colRate('On evil', (r) => r.onEvil, (r) => r.nomsN, 'evil', 'Nominations on evil players')] : []),
    h.colNum(side === 'good' ? 'Evil executed' : side === 'evil' ? 'Good executed' : 'Executed', (r) => r.execs),
    { ...h.colNum('Per game', (r) => r.perGame), cell: (r) => `<td class="num">${r.perGame.toFixed(2)}</td>` },
    ...(side === 'good' ? [h.colRate('Votes on evil', (r) => r.votesEvil, (r) => r.votes, 'evil', 'Votes on evil players')] : []),
  ];
  return card(title, sub, h.sortable(`ps-noms-${side}`, cols, rows, { sort: side === 'good' ? 5 : 4 }), 'wide');
}

// ---------- the page ----------
// h: { side, selected (player keys), playerLink, sortable, colPlayer, colNum, colRate }
export function playstylesView(games, h) {
  const side = h.side;
  const R = playstyles(games, side);
  const sideWord = side === 'good' ? 'as good' : side === 'evil' ? 'as evil' : '';
  const toggles = `<div class="toggles ps-sides" role="group" aria-label="Which games">${STYLE_SIDES.map(([v, l]) => `<button class="toggle" data-style-side="${v}" aria-pressed="${v === side}">${l}</button>`).join('')}</div>`;
  const head = `<div class="ps-head"><p class="summary lead">Who tends to die early, who gets executed, who makes it to the end, and who sniffs out the other team${sideWord ? `, in games ${sideWord}` : ''}.</p>${toggles}</div>`;
  if (!R.players.length) return `${head}<div class="card empty"><h2>Not enough games yet</h2><p>Playstyles need players with at least ${plural(R.minGames, 'game')}${sideWord ? ` ${sideWord}` : ''} under these filters.</p></div>`;

  // Tiles: how many players, how many styles, and one positive spotlight.
  const lead = (id) => [...R.players].sort((a, b) => b.values[id].shrunk - a.values[id].shrunk)[0];
  const spot = side === 'good' ? ['Top hound dog', 'enemyExecs', (p) => `${p.t.enemyExecs} evil executed from ${plural(p.t.noms, 'nomination')}`]
    : side === 'evil' ? ['Top framer', 'enemyExecs', (p) => `${p.t.enemyExecs} good executed from ${plural(p.t.noms, 'nomination')}`]
      : ['Best survivor', 'survived', (p) => `alive at the end of ${p.t.fates.survivedWon + p.t.fates.survivedLost} of ${plural(p.t.known, 'game')}`];
  const star = R.featureIds.includes(spot[1]) ? lead(spot[1]) : null;
  const tiles = [
    tile('Players', R.players.length, `with ${R.minGames}+ games${sideWord ? ` ${sideWord}` : ''}${R.others ? ` · ${R.others} with fewer left out` : ''}`, 'hero'),
    tile('Playstyles found', R.groups.length || '–', R.groups.length ? `groups ${clarity(R.silhouette).split(' — ')[0]}` : 'needs 6+ players'),
    star ? tile(spot[0], `<span style="font-size:${Math.min(1, 11 / Math.max(1, [...star.name].length)).toFixed(2)}em">${h.playerLink(star.key, star.name)}</span>`, spot[2](star), 'highlight feature') : '',
  ];

  const out = [];
  if (R.groups.length) {
    const sub = `Players close together play alike. Each axis blends the rates that differ most between players. The ${plural(R.groups.length, 'group')} are ${clarity(R.silhouette)}. Click a player for their stats.`;
    out.push(card('Player map', sub, `${groupLegend(R)}<div class="ps-scroll">${mapSvg(R, h.selected)}</div>`, 'wide ps-map-card'));
    for (const g of R.groups) out.push(groupCard(R, g, h.playerLink));
  } else {
    out.push(card('Player map', '', `<p class="muted">The map and groups need at least 6 players with ${plural(R.minGames, 'game')}${sideWord ? ` ${sideWord}` : ''}. There ${R.players.length === 1 ? 'is' : 'are'} ${R.players.length} so far.</p>`, 'wide'));
  }
  out.push(fatesCard(R, h.playerLink, sideWord));
  out.push(nominationsCard(R, h));
  out.push(card('How this works', '', `<details class="ps-how"><summary>The method, in a few lines</summary>
    <p>Every seat gets one fate from when the player died and whether a nomination executed them that day (a day death without one, like a Slayer shot, counts as "killed"). Travellers are left out.</p>
    <p>Each player then gets a handful of rates: killed early, executed early, executed on the final day, survived, win rate, nominations per game${side === 'good' ? ', how often their nominations and votes land on evil' : ''}, and how often their nominations get the other team executed. Every rate is pulled toward the table-wide rate as if the player had 5 extra average games, so a hot streak over a few games can't make someone look extreme.</p>
    <p>The rates are put on one scale and grouped with k-means; the number of groups (2 to 4) is the one where the groups are most clearly apart. Each group is named after what sets it apart most. The map squeezes all the rates onto two axes (principal components), so distance on it is approximate.</p>
  </details>`, 'wide'));
  return `${head}<div class="tiles">${tiles.join('')}</div><div class="grid two">${out.join('')}</div>`;
}
