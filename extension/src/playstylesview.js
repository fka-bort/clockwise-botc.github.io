// The Playstyles tab: everyone "at the table" (nominations, votes, time alive), how each player's games end, and who
// leads the table to the other team. The numbers come from playstyles.js and tabletalk.js; this file only draws them.

import { playstyles, FATES } from './playstyles.js';
import { esc, pct, plural, card, tile } from './ui.js';

export const STYLE_SIDES = [['good', 'As good'], ['evil', 'As evil'], ['all', 'All games']];
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
  const body = `${fateLegend()}<div class="ps-bars">${everyone}<div class="ps-gh"></div>${rows(R.players)}</div>`;
  const unknown = R.pooled.games - R.pooled.known;
  const note = unknown ? `<p class="muted small">${plural(unknown, 'seat')} left out where the player died before anyone was recording.</p>` : '';
  return card(`How their games end${sideWord ? ` ${sideWord}` : ''}`, 'Each player\'s fate in every game, early exits first. "Early" means by the end of Day 2. Hover a segment for the count.', body + note, 'wide span-all');
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
  return card(title, sub, h.sortable(`ps-noms-${side}`, cols, rows, { sort: side === 'good' ? 5 : 4 }), 'wide span-all');
}

// ---------- at the table ----------
// Everyone ranked on the same four measures as the player page, for the side picked at the top.
function talkTable(side, h) {
  const T = h.talk[side];
  const rows = T.players.filter((p) => p.listed);
  const sideWord = side === 'all' ? '' : `as ${side}`;
  const col = (id, label) => ({ label, value: (p) => p.rates[id].value, cell: (p) => `<td>${h.talkCell(T, p, id, side)}</td>` });
  const sub = `Per day alive, next to the average player, for players with ${T.minGames}+ games${sideWord ? ` ${sideWord}` : ''}${side === 'all' ? '' : ' (only games where they kept one alignment the whole game)'}. Click a column to sort.`;
  return card('At the table', sub, h.sortable(`ps-talk-${side}`, [h.colPlayer(), h.colNum('Games', (p) => p.games),
    col('loud', 'Nominations / day'), col('nominated', 'Nominated / day'), col('voter', 'Votes while alive'), col('life', 'Share of game alive')], rows, { sort: 2, empty: 'Not enough games yet.' }), 'wide span-all');
}

// ---------- the page ----------
// h: { side, playerLink, sortable, colPlayer, colNum, colRate, talk, talkCell }
export function playstylesView(games, h) {
  const side = h.side;
  const R = playstyles(games, side);
  const sideWord = side === 'good' ? 'as good' : side === 'evil' ? 'as evil' : '';
  const toggles = `<div class="toggles ps-sides" role="group" aria-label="Which games">${STYLE_SIDES.map(([v, l]) => `<button class="toggle" data-style-side="${v}" aria-pressed="${v === side}">${l}</button>`).join('')}</div>`;
  const head = `<div class="ps-head"><p class="summary lead">Who tends to die early, who gets executed, who makes it to the end, and who sniffs out the other team${sideWord ? `, in games ${sideWord}` : ''}.</p>${toggles}</div>`;
  if (!R.players.length) return `${head}<div class="card empty"><h2>Not enough games yet</h2><p>Playstyles need players with at least ${plural(R.minGames, 'game')}${sideWord ? ` ${sideWord}` : ''} under these filters.</p></div>`;

  // Tiles: how many players, how often anyone survives, and one positive spotlight.
  const lead = (id) => [...R.players].sort((a, b) => b.values[id].shrunk - a.values[id].shrunk)[0];
  const spot = side === 'good' ? ['Top hound dog', 'enemyExecs', (p) => `${p.t.enemyExecs} evil executed from ${plural(p.t.noms, 'nomination')}`]
    : side === 'evil' ? ['Top framer', 'enemyExecs', (p) => `${p.t.enemyExecs} good executed from ${plural(p.t.noms, 'nomination')}`]
      : ['Best survivor', 'survived', (p) => `alive at the end of ${p.t.fates.survivedWon + p.t.fates.survivedLost} of ${plural(p.t.known, 'game')}`];
  const star = R.featureIds.includes(spot[1]) ? lead(spot[1]) : null;
  const tiles = [
    tile('Players', R.players.length, `with ${R.minGames}+ games${sideWord ? ` ${sideWord}` : ''}${R.others ? ` · ${R.others} with fewer left out` : ''}`, 'hero'),
    tile('Survived to the end', pct((R.pooled.fates.survivedWon + R.pooled.fates.survivedLost) / (R.pooled.known || 1)), `of every player's games${sideWord ? ` ${sideWord}` : ''}`),
    star ? tile(spot[0], `<span style="font-size:${Math.min(1, 11 / Math.max(1, [...star.name].length)).toFixed(2)}em">${h.playerLink(star.key, star.name)}</span>`, spot[2](star), 'highlight feature') : '',
  ];

  const out = [];
  out.push(talkTable(side, h));
  out.push(fatesCard(R, h.playerLink, sideWord));
  out.push(nominationsCard(R, h));
  out.push(card('How this works', '', `<details class="ps-how"><summary>How these are worked out</summary>
    <p>Every seat gets one fate. The recordings show night deaths at the start of the next day, so a death counts as an execution when the player was nominated that day with enough votes, and otherwise as killed (by the demon or an ability). "Early" means by the end of Day 2. Travellers are left out.</p>
    <p>At the table and the nomination table only use games recorded from the start, since earlier days are missing otherwise. At the table counts per day alive, so someone killed on Night 1 doesn't look quiet, and as good / as evil only use games where the player kept one alignment the whole game.</p>
    <p>The spotlight tile pulls each player's rate toward the table-wide rate as if they had 5 extra average games, so a lucky handful of games can't win it.</p>
  </details>`, 'wide span-all'));
  return `${head}<div class="tiles">${tiles.join('')}</div><div class="grid two">${out.join('')}</div>`;
}
