// Playstyles: how each player's games tend to end (killed early, executed, survived…), how they nominate, and which
// players play alike. Pure functions (no DOM), so it can be checked in Node.
//
// Method, in short:
//   1. Every seat in every game gets one "fate" (FATES below) from its death phase, the deaths and the nominations.
//   2. Each player gets a handful of rates on one side (as good, as evil, or both). Rates are pulled towards the
//      table-wide rate by SHRINK pretend games, so a player with 6 games can't look extreme by luck alone.
//   3. The rates are put on one scale (z-scores) and k-means groups players who look alike. The number of groups
//      (2–4) is the one with the best silhouette, i.e. the groups that are most clearly apart.
//   4. Each group is named after what sets it apart most (e.g. executed early far more than average → "Lightning rod").
//   5. For the map, PCA squeezes the rates onto two axes; players close together play alike.

import { playerKey, displayName } from './stats.js';

export const SIDES = ['good', 'evil', 'all'];
const SHRINK = 5; // pretend games at the table-wide rate added to every player's own
export const MIN_GAMES = { good: 5, evil: 3, all: 5 };
const MAX_GROUPS = 4;

// One per seat, in the order a game unfolds. "Early" means by the end of Day 2.
export const FATES = [
  { id: 'killedEarly', label: 'Killed early', tip: 'Died at night (or to an ability) by the end of Day 2' },
  { id: 'execEarly', label: 'Executed early', tip: 'Executed on Day 1 or Day 2' },
  { id: 'diedLater', label: 'Died later on', tip: 'Died after Day 2, other than being executed on the final day' },
  { id: 'execFinal', label: 'Executed on the final day', tip: 'Executed on the last day of the game. As good in a game evil won, this is the frame' },
  { id: 'survivedLost', label: 'Survived, lost', tip: 'Alive at the end, on the losing team' },
  { id: 'survivedWon', label: 'Survived, won', tip: 'Alive at the end, on the winning team' },
];

// ---------- per game ----------
const majorityMet = (n) => typeof n.votes !== 'number' || !n.majority || n.votes >= n.majority;
// Seat → the nomination that executed them (the last one that day with enough votes), for players who died in the
// day right after being nominated. Day deaths with no such nomination (Slayer shots, Virgin…) aren't executions.
function executions(g) {
  const out = new Map();
  for (const d of g.deaths || []) {
    if (d.atNight || !d.phase) continue;
    const noms = (g.nominations || []).filter((n) => n.phase === d.phase && n.nomineeSeat === d.seat && n.type !== 'exile' && n.completed !== false && majorityMet(n));
    if (noms.length) out.set(d.seat, { phase: d.phase, by: noms[noms.length - 1].nominatorSeat });
  }
  return out;
}

export function seatFate(g, p, exec = executions(g)) {
  if (p.survived) return p.won ? 'survivedWon' : 'survivedLost';
  if (!p.diedPhase) return null; // died before anyone was recording
  const day = Math.ceil(p.diedPhase / 2);
  const night = p.diedPhase % 2 === 1;
  const e = exec.get(p.seat);
  const executed = !night && e && e.phase === p.diedPhase;
  if (executed && day >= (g.days || day)) return 'execFinal';
  if (day <= 2) return executed ? 'execEarly' : 'killedEarly';
  return 'diedLater';
}

// Everything per seat the rates are built from.
function seatRecords(games) {
  const out = [];
  for (const g of games) {
    const exec = executions(g);
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    // Nominations and votes only count for games recorded from the start, since earlier days are missing otherwise.
    const tracked = !g.joinedAtPhase;
    for (const p of g.players) {
      const key = playerKey(p);
      if (!key || p.isTraveller || (p.alignment !== 'good' && p.alignment !== 'evil')) continue;
      const r = { g, p, key, side: p.alignment, fate: seatFate(g, p, exec), won: !!p.won, tracked, noms: 0, nomsOnEvil: 0, enemyExecs: 0, votes: 0, votesOnEvil: 0 };
      if (tracked) {
        for (const n of g.nominations || []) {
          if (n.type === 'exile') continue;
          const nominee = bySeat.get(n.nomineeSeat);
          const onEvil = nominee && nominee.alignment === 'evil';
          if (n.nominatorSeat === p.seat) { r.noms++; if (onEvil) r.nomsOnEvil++; }
          if ((n.voters || []).some((v) => v.seat === p.seat)) { r.votes++; if (onEvil) r.votesOnEvil++; }
        }
        for (const [seat, e] of exec) {
          const nominee = bySeat.get(seat);
          if (e.by === p.seat && nominee && nominee.alignment && nominee.alignment !== p.alignment && !nominee.isTraveller) r.enemyExecs++;
        }
      }
      out.push(r);
    }
  }
  return out;
}

// ---------- per player ----------
const blank = () => ({ games: 0, wins: 0, known: 0, fates: Object.fromEntries(FATES.map((f) => [f.id, 0])), tracked: 0, noms: 0, nomsOnEvil: 0, enemyExecs: 0, votes: 0, votesOnEvil: 0 });
function add(t, r) {
  t.games++;
  if (r.won) t.wins++;
  if (r.fate) { t.known++; t.fates[r.fate]++; }
  if (r.tracked) { t.tracked++; t.noms += r.noms; t.nomsOnEvil += r.nomsOnEvil; t.enemyExecs += r.enemyExecs; t.votes += r.votes; t.votesOnEvil += r.votesOnEvil; }
}

// Features: what each is out of (`of`), and what to call a group that stands out on it, per side.
// `high`/`low`: names for a group well above / below average on it.
const FEATURES = {
  killedEarly: { label: 'Killed early', short: 'killed early', of: 'known', count: (t) => t.fates.killedEarly, pct: true, sides: ['good', 'evil', 'all'], high: { good: 'Demon\'s first pick', evil: 'Early casualty', all: 'Early target' } },
  execEarly: { label: 'Executed early', short: 'executed early', of: 'known', count: (t) => t.fates.execEarly, pct: true, sides: ['good', 'evil', 'all'], high: { good: 'Lightning rod', evil: 'Caught early', all: 'Lightning rod' } },
  execFinal: { label: 'Executed on the final day', short: 'executed last day', of: 'known', count: (t) => t.fates.execFinal, pct: true, sides: ['good', 'evil', 'all'], high: { good: 'The frame', evil: 'Caught at the end', all: 'Final-day pick' } },
  survived: { label: 'Survived to the end', short: 'survived', of: 'known', count: (t) => t.fates.survivedWon + t.fates.survivedLost, pct: true, sides: ['good', 'evil', 'all'], high: { good: 'Survivor', evil: 'Untouchable', all: 'Survivor' }, low: { good: 'Short-lived', evil: 'Short-lived', all: 'Short-lived' } },
  winRate: { label: 'Win rate', short: 'wins', of: 'games', count: (t) => t.wins, pct: true, sides: ['good', 'evil', 'all'], high: { good: 'Town hero', evil: 'Mastermind', all: 'Winner' } },
  noms: { label: 'Nominations per game', short: 'nominations', of: 'tracked', count: (t) => t.noms, pct: false, sides: ['good', 'evil', 'all'], high: { good: 'Instigator', evil: 'Instigator', all: 'Instigator' }, low: { good: 'Quiet one', evil: 'Quiet one', all: 'Quiet one' } },
  nomAccuracy: { label: 'Nominations on evil players', short: 'nominates evil', of: 'noms', count: (t) => t.nomsOnEvil, pct: true, sides: ['good'], high: { good: 'Sharp nose' } },
  enemyExecs: { label: 'Evil executed from their nominations, per game', evilLabel: 'Good executed from their nominations, per game', allLabel: 'Other team executed from their nominations, per game', short: 'gets evil executed', evilShort: 'gets good executed', allShort: 'gets opponents executed', of: 'tracked', count: (t) => t.enemyExecs, pct: false, sides: ['good', 'evil', 'all'], high: { good: 'Hound dog', evil: 'The framer', all: 'Closer' } },
  voteAccuracy: { label: 'Votes on evil players', short: 'votes on evil', of: 'votes', count: (t) => t.votesOnEvil, pct: true, sides: ['good'], high: { good: 'Sharp voter' } },
};
export const featureLabel = (id, side) => (side === 'evil' && FEATURES[id].evilLabel) || (side === 'all' && FEATURES[id].allLabel) || FEATURES[id].label;
export const featureShort = (id, side) => (side === 'evil' && FEATURES[id].evilShort) || (side === 'all' && FEATURES[id].allShort) || FEATURES[id].short;
export const featureIsPct = (id) => FEATURES[id].pct;

// Raw and shrunk value of one feature for one tally, given the table-wide (pooled) rate.
function value(id, t, pooled) {
  const f = FEATURES[id];
  const n = t[f.of], x = f.count(t);
  return { raw: n ? x / n : null, n, shrunk: (x + SHRINK * pooled) / (n + SHRINK) };
}

// ---------- k-means & PCA (small, dependency-free, seeded so the page doesn't reshuffle on every render) ----------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dist2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
const mean = (rows) => rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);

function kmeansOnce(X, k, rand) {
  // k-means++ start
  const C = [X[Math.floor(rand() * X.length)]];
  while (C.length < k) {
    const d = X.map((x) => Math.min(...C.map((c) => dist2(x, c))));
    const total = d.reduce((s, v) => s + v, 0);
    let pick = rand() * total, i = 0;
    while (i < X.length - 1 && (pick -= d[i]) > 0) i++;
    C.push(X[i]);
  }
  let labels = new Array(X.length).fill(-1);
  for (let iter = 0; iter < 100; iter++) {
    const next = X.map((x) => C.reduce((best, c, j) => (dist2(x, c) < dist2(x, C[best]) ? j : best), 0));
    const same = next.every((l, i) => l === labels[i]);
    labels = next;
    for (let j = 0; j < k; j++) { const m = X.filter((_, i) => labels[i] === j); if (m.length) C[j] = mean(m); }
    if (same) break;
  }
  const inertia = X.reduce((s, x, i) => s + dist2(x, C[labels[i]]), 0);
  return { labels, centroids: C, inertia };
}
function kmeans(X, k, seed = 7) {
  const rand = rng(seed);
  let best = null;
  for (let r = 0; r < 30; r++) {
    const run = kmeansOnce(X, k, rand);
    const sizes = Array.from({ length: k }, (_, j) => run.labels.filter((l) => l === j).length);
    if (sizes.some((s) => s < 2)) continue; // a "group" of one player isn't a playstyle
    if (!best || run.inertia < best.inertia) best = run;
  }
  return best;
}
// Mean silhouette: how much closer each player is to their own group than to the next nearest one (-1 to 1).
function silhouette(X, labels, k) {
  const d = X.map((a) => X.map((b) => Math.sqrt(dist2(a, b))));
  let s = 0;
  X.forEach((_, i) => {
    const avg = (j) => { const m = labels.map((l, q) => (l === j && q !== i ? d[i][q] : null)).filter((v) => v !== null); return m.length ? m.reduce((a, b) => a + b, 0) / m.length : 0; };
    const a = avg(labels[i]);
    const b = Math.min(...Array.from({ length: k }, (_, j) => j).filter((j) => j !== labels[i]).map(avg));
    s += Math.max(a, b) ? (b - a) / Math.max(a, b) : 0;
  });
  return s / X.length;
}
// Top two principal components by power iteration (X is already centred).
function pca2(X) {
  const p = X[0].length;
  const cov = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) / Math.max(1, X.length - 1)));
  const total = cov.reduce((s, r, i) => s + r[i], 0);
  const comps = [];
  const M = cov.map((r) => r.slice());
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: p }, (_, i) => 1 / Math.sqrt(p) + i * 1e-3);
    let lambda = 0;
    for (let it = 0; it < 500; it++) {
      const w = M.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      v = w.map((x) => x / norm);
      lambda = norm;
    }
    // Point the axis so its biggest loading is positive (stable orientation between renders).
    const big = v.reduce((b, x, i) => (Math.abs(x) > Math.abs(v[b]) ? i : b), 0);
    if (v[big] < 0) v = v.map((x) => -x);
    comps.push({ loadings: v, share: total ? lambda / total : 0 });
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) M[i][j] -= lambda * v[i] * v[j];
  }
  return { comps, coords: X.map((r) => comps.map((c) => r.reduce((s, x, j) => s + x * c.loadings[j], 0))) };
}

// ---------- the whole analysis ----------
// side: 'good' | 'evil' | 'all'. Returns players (each with fates, rates, group and map position), the groups
// (named, with what sets them apart) and the map's axes. Groups and map need at least 6 players with enough games.
export function playstyles(games, side = 'good', { minGames = MIN_GAMES[side] } = {}) {
  const recs = seatRecords(games).filter((r) => side === 'all' || r.side === side);
  const byPlayer = new Map();
  const pooled = blank();
  for (const r of recs) {
    if (!byPlayer.has(r.key)) byPlayer.set(r.key, { key: r.key, name: displayName(r.key, r.p.username), t: blank() });
    add(byPlayer.get(r.key).t, r);
    add(pooled, r);
  }
  const featureIds = Object.keys(FEATURES).filter((id) => FEATURES[id].sides.includes(side) && pooled[FEATURES[id].of] > 0);
  const poolRate = Object.fromEntries(featureIds.map((id) => [id, FEATURES[id].count(pooled) / pooled[FEATURES[id].of]]));
  const everyone = [...byPlayer.values()].map((pl) => ({
    ...pl,
    games: pl.t.games,
    values: Object.fromEntries(featureIds.map((id) => [id, value(id, pl.t, poolRate[id])])),
  })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const players = everyone.filter((pl) => pl.games >= minGames);
  const result = { side, minGames, pooled, poolRate, featureIds, players, others: everyone.length - players.length, groups: [], axes: null };
  if (players.length < 6) return result;

  // z-scores of the shrunk rates; features that don't vary are dropped.
  const used = featureIds.filter((id) => {
    const v = players.map((pl) => pl.values[id].shrunk);
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) > 1e-9;
  });
  const stats = Object.fromEntries(used.map((id) => {
    const v = players.map((pl) => pl.values[id].shrunk);
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return [id, { mean: m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) }];
  }));
  const X = players.map((pl) => used.map((id) => (pl.values[id].shrunk - stats[id].mean) / stats[id].sd));
  players.forEach((pl, i) => { pl.z = Object.fromEntries(used.map((id, j) => [id, X[i][j]])); });

  // Pick the number of groups with the best silhouette.
  let best = null;
  for (let k = 2; k <= Math.min(MAX_GROUPS, Math.floor(players.length / 3)); k++) {
    const run = kmeans(X, k);
    if (!run) continue;
    const s = silhouette(X, run.labels, k);
    if (!best || s > best.silhouette + 0.02) best = { ...run, k, silhouette: s };
  }
  if (!best) return result;

  // Biggest group first, so the colours stay put when a filter nudges the groups a little.
  const order = Array.from({ length: best.k }, (_, j) => j).sort((a, b) => best.labels.filter((l) => l === b).length - best.labels.filter((l) => l === a).length);
  const groups = order.map((j, idx) => {
    const members = players.filter((_, i) => best.labels[i] === j);
    const centre = Object.fromEntries(used.map((id, f) => [id, best.centroids[j][f]]));
    // Raw rates for the group as a whole (its members' games pooled), next to everyone in the analysis.
    const t = blank();
    for (const m of members) for (const k of Object.keys(t)) { if (k === 'fates') for (const f of FATES) t.fates[f.id] += m.t.fates[f.id]; else t[k] += m.t[k]; }
    const all = blank();
    for (const m of players) for (const k of Object.keys(all)) { if (k === 'fates') for (const f of FATES) all.fates[f.id] += m.t.fates[f.id]; else all[k] += m.t[k]; }
    const traits = used.map((id) => ({ id, z: centre[id], label: featureLabel(id, side), short: featureShort(id, side), pct: FEATURES[id].pct,
      group: FEATURES[id].count(t) / (t[FEATURES[id].of] || 1), everyone: FEATURES[id].count(all) / (all[FEATURES[id].of] || 1) }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    members.forEach((m) => { m.group = idx; });
    return { index: idx, members, centre, traits, fates: t.fates, known: t.known };
  });
  nameGroups(groups, side);
  result.groups = groups;
  result.k = best.k;
  result.silhouette = best.silhouette;

  // The map.
  const { comps, coords } = pca2(X);
  players.forEach((pl, i) => { pl.xy = coords[i]; });
  result.axes = comps.map((c) => {
    const ranked = used.map((id, j) => ({ id, w: c.loadings[j], label: featureShort(id, side) })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    return { share: c.share, pos: ranked.filter((r) => r.w > 0.3).slice(0, 2), neg: ranked.filter((r) => r.w < -0.3).slice(0, 2) };
  });
  return result;
}

// Each group gets the name of its most distinctive trait that no other group has taken (strongest groups pick first).
function nameGroups(groups, side) {
  const taken = new Set();
  const nameFor = (tr) => {
    const f = FEATURES[tr.id];
    if (tr.z > 0.3 && f.high && f.high[side]) return f.high[side];
    if (tr.z < -0.3 && f.low && f.low[side]) return f.low[side];
    return null;
  };
  const byStrength = [...groups].sort((a, b) => Math.abs(b.traits[0].z) - Math.abs(a.traits[0].z));
  for (const g of byStrength) {
    const pick = g.traits.map((tr) => nameFor(tr)).find((n) => n && !taken.has(n));
    g.name = pick || 'Middle of the road';
    taken.add(g.name);
    // What sets them apart: the traits furthest from average, in plain words.
    g.standout = g.traits.filter((tr) => Math.abs(tr.z) >= 0.35).slice(0, 3);
  }
  // Two groups with nothing to name them by: number them.
  const plain = groups.filter((g) => g.name === 'Middle of the road');
  if (plain.length > 1) plain.forEach((g, i) => { g.name = `Middle of the road ${i + 1}`; });
}
