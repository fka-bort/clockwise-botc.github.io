// "At the table": how loud or quiet each player is, how often they're nominated, how often they vote, how long they
// live, and who they nominate (and get nominated by) most. Pure functions (no DOM).
//
// Everything is per DAY ALIVE, so someone killed on Night 1 isn't counted as quiet. A player is alive on day d if they
// survived, or died later than day d. Night deaths show up at the start of the next day in the recordings, so a death
// on day d counts as day d alive only if it was an execution (they were nominated that day with enough votes) or
// they nominated someone that day; otherwise they're taken to have died the night before.
//
// Only games recorded from the start count (earlier days are missing otherwise), and travellers are left out.
// The alignment split (as good / as evil) uses only games where the player kept one alignment the whole game:
// their character never changed and its team matches the alignment they ended on.
//
// Rates are pulled toward the table-wide rate by a few pretend days/votes/games (SHRINK), so players with little data
// don't top or bottom the rankings by luck. Percentiles compare each player with everyone with enough games.

import { playerKey, displayName } from './stats.js';

export const MIN_GAMES = { all: 5, good: 3, evil: 3 };
const SHRINK = { perDay: 8, votes: 20, life: 3 }; // pretend days, vote chances, games
const homeSide = (team) => (team === 'townsfolk' || team === 'outsider' ? 'good' : team === 'minion' || team === 'demon' ? 'evil' : null);
const dayOf = (n) => n.day || (n.phase ? Math.ceil(n.phase / 2) : null);
const enoughVotes = (n) => typeof n.votes !== 'number' || !n.majority || n.votes >= n.majority;

// The last day each seat was alive for, in one game.
function lastDays(g) {
  const out = new Map();
  const days = g.days || 0;
  const noms = (g.nominations || []).filter((n) => n.type !== 'exile');
  for (const p of g.players) {
    if (p.survived) { out.set(p.seat, days); continue; }
    if (!p.diedPhase) { out.set(p.seat, null); continue; } // died before recording started
    const d = Math.ceil(p.diedPhase / 2);
    if (p.diedPhase % 2 === 1) { out.set(p.seat, d - 1); continue; } // died at night
    const executed = noms.some((n) => dayOf(n) === d && n.nomineeSeat === p.seat && n.completed !== false && enoughVotes(n));
    const spoke = noms.some((n) => dayOf(n) === d && n.nominatorSeat === p.seat);
    out.set(p.seat, executed || spoke ? d : d - 1);
  }
  return out;
}

// One record per seat in each usable game.
export function seatRecords(games) {
  const out = [];
  for (const g of games) {
    if (g.joinedAtPhase || !g.days) continue;
    const last = lastDays(g);
    const noms = (g.nominations || []).filter((n) => n.type !== 'exile');
    for (const p of g.players) {
      const key = playerKey(p);
      const alive = last.get(p.seat);
      if (!key || p.isTraveller || alive === null || alive === undefined || (p.alignment !== 'good' && p.alignment !== 'evil')) continue;
      const steady = homeSide(p.team) === p.alignment && (!p.startingRoleId || p.startingRoleId === p.roleId);
      const r = { g, p, key, side: p.alignment, steady, days: Math.max(alive, 0), gameDays: g.days, made: 0, received: 0, votes: 0, chances: 0 };
      for (const n of noms) {
        const d = dayOf(n);
        if (n.nominatorSeat === p.seat) r.made++;
        if (n.nomineeSeat === p.seat) r.received++;
        if (d && d <= alive && n.completed !== false) {
          r.chances++;
          if ((n.voters || []).some((v) => v.seat === p.seat)) r.votes++;
        }
      }
      out.push(r);
    }
  }
  return out;
}

const blank = () => ({ games: 0, days: 0, made: 0, received: 0, votes: 0, chances: 0, life: 0 });
function add(t, r) {
  t.games++; t.days += r.days; t.made += r.made; t.received += r.received; t.votes += r.votes; t.chances += r.chances;
  t.life += r.days / r.gameDays;
}
// The measures, each as [count, exposure, kind of shrinkage].
export const MEASURES = {
  loud: { label: 'Nominations per day alive', get: (t) => [t.made, t.days], shrink: SHRINK.perDay, fmt: (v) => v.toFixed(2) },
  nominated: { label: 'Times nominated per day alive', get: (t) => [t.received, t.days], shrink: SHRINK.perDay, fmt: (v) => v.toFixed(2) },
  voter: { label: 'Votes on nominations while alive', get: (t) => [t.votes, t.chances], shrink: SHRINK.votes, fmt: (v) => `${Math.round(v * 100)}%` },
  life: { label: 'Share of the game alive', get: (t) => [t.life, t.games], shrink: SHRINK.life, fmt: (v) => `${Math.round(v * 100)}%` },
};

// Share of `others` below v (ties count half), as 0–1.
const percentile = (v, others) => (others.length ? (others.filter((o) => o < v).length + 0.5 * others.filter((o) => o === v).length) / others.length : null);

// For each side ('all', 'good', 'evil'): every player's totals, raw and shrunk rates, and percentiles among players
// with enough games on that side.
export function tableTalk(games) {
  const recs = seatRecords(games);
  const out = {};
  for (const side of ['all', 'good', 'evil']) {
    const use = side === 'all' ? recs : recs.filter((r) => r.side === side && r.steady);
    const by = new Map(), pooled = blank();
    for (const r of use) {
      if (!by.has(r.key)) by.set(r.key, { key: r.key, name: displayName(r.key, r.p.username), t: blank() });
      add(by.get(r.key).t, r);
      add(pooled, r);
    }
    const table = Object.fromEntries(Object.entries(MEASURES).map(([id, m]) => { const [c, n] = m.get(pooled); return [id, n ? c / n : null]; }));
    const players = [...by.values()].map((pl) => {
      const rates = {};
      for (const [id, m] of Object.entries(MEASURES)) {
        const [c, n] = m.get(pl.t);
        rates[id] = { raw: n ? c / n : null, n, value: table[id] === null ? null : (c + m.shrink * table[id]) / (n + m.shrink) };
      }
      return { ...pl, games: pl.t.games, rates, ranked: pl.t.games >= MIN_GAMES[side] };
    });
    const ranked = players.filter((p) => p.ranked);
    for (const pl of players) {
      pl.pct = {};
      for (const id of Object.keys(MEASURES)) {
        const others = ranked.filter((o) => o !== pl).map((o) => o.rates[id].value);
        pl.pct[id] = pl.ranked && pl.rates[id].value !== null ? percentile(pl.rates[id].value, others) : null;
      }
    }
    out[side] = { players: players.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)), table, ranked: ranked.length, minGames: MIN_GAMES[side] };
  }
  return out;
}

// Who `key` nominates most, and who nominates them most, with how many games they sat in together.
// Every recorded nomination counts (also from games joined part-way).
export function nominationPairs(games, key) {
  const made = new Map(), got = new Map(), together = new Map();
  const bump = (m, k, name) => { const r = m.get(k) || { key: k, name, n: 0 }; r.n++; m.set(k, r); };
  for (const g of games) {
    const me = g.players.find((p) => playerKey(p) === key);
    if (!me) continue;
    for (const p of g.players) { const k = playerKey(p); if (k && k !== key) together.set(k, (together.get(k) || 0) + 1); }
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    for (const n of g.nominations || []) {
      if (n.type === 'exile') continue;
      const from = bySeat.get(n.nominatorSeat), to = bySeat.get(n.nomineeSeat);
      if (!from || !to) continue;
      if (n.nominatorSeat === me.seat && playerKey(to) && playerKey(to) !== key) bump(made, playerKey(to), displayName(playerKey(to), to.username));
      if (n.nomineeSeat === me.seat && playerKey(from) && playerKey(from) !== key) bump(got, playerKey(from), displayName(playerKey(from), from.username));
    }
  }
  const finish = (m) => [...m.values()].map((r) => ({ ...r, games: together.get(r.key) || 0, perGame: r.n / (together.get(r.key) || 1) }))
    .sort((a, b) => b.n - a.n || b.perGame - a.perGame || a.name.localeCompare(b.name));
  return { nominates: finish(made), nominatedBy: finish(got) };
}
