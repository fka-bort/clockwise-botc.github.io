"""Playstyle analysis for Clockwise game exports, in Python.

This mirrors extension/src/playstyles.js (the dashboard's Playstyles tab) so the method can be explored, tuned and
checked in a notebook. Same fates, same features, same shrinkage; clustering uses scikit-learn's KMeans.

    from playstyles import load_games, seat_table, player_table, feature_matrix
    games = load_games("../sample-data/botc-sample-games.json")
    seats = seat_table(games)                       # one row per player per game
    players = player_table(seats, side="good")      # one row per player: counts, raw and shrunk rates
    X, used = feature_matrix(players, side="good")  # z-scored shrunk rates, ready for clustering
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

SHRINK = 5  # pretend games at the table-wide rate added to every player's own
MIN_GAMES = {"good": 5, "evil": 3, "all": 5}

# One per seat, in the order a game unfolds. "Early" means by the end of Day 2.
FATES = ["killedEarly", "execEarly", "diedLater", "execFinal", "survivedLost", "survivedWon"]
FATE_LABELS = {
    "killedEarly": "Killed early",
    "execEarly": "Executed early",
    "diedLater": "Died later on",
    "execFinal": "Executed on the final day",
    "survivedLost": "Survived, lost",
    "survivedWon": "Survived, won",
}
# Same validated palette as the dashboard (light mode).
FATE_COLORS = {
    "killedEarly": "#6250d6", "execEarly": "#eb6834", "diedLater": "#1baf7a",
    "execFinal": "#eda100", "survivedLost": "#e87ba4", "survivedWon": "#008300",
}
GROUP_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#5f5070", "#e87ba4", "#eda100", "#6250d6", "#008300"]

# Features: numerator column, denominator column, which sides they apply to, and group names (high / low).
FEATURES = {
    "killedEarly": dict(num="f_killedEarly", den="known", label="Killed early", sides=("good", "evil", "all"),
                        high={"good": "Demon's first pick", "evil": "Early casualty", "all": "Early target"}),
    "execEarly": dict(num="f_execEarly", den="known", label="Executed early", sides=("good", "evil", "all"),
                      high={"good": "Lightning rod", "evil": "Caught early", "all": "Lightning rod"}),
    "diedLater": dict(num="f_diedLater", den="known", label="Died later on", sides=("good", "evil", "all")),
    "execFinal": dict(num="f_execFinal", den="known", label="Executed on final day", sides=("good", "evil", "all"),
                      high={"good": "The frame", "evil": "Caught at the end", "all": "Final-day pick"}),
    "survived": dict(num="survived", den="known", label="Survived", sides=("good", "evil", "all"),
                     high={s: n for s, n in [("good", "Survivor"), ("evil", "Untouchable"), ("all", "Survivor")]},
                     low={"good": "Short-lived", "evil": "Short-lived", "all": "Short-lived"}),
    "winRate": dict(num="wins", den="games", label="Win rate", sides=("good", "evil", "all"),
                    high={"good": "Town hero", "evil": "Mastermind", "all": "Winner"}),
    "noms": dict(num="noms", den="tracked", label="Nominations per game", sides=("good", "evil", "all"),
                 high={"good": "Instigator", "evil": "Instigator", "all": "Instigator"},
                 low={"good": "Quiet one", "evil": "Quiet one", "all": "Quiet one"}),
    "nomAccuracy": dict(num="nomsOnEvil", den="noms", label="Nominates evil", sides=("good",),
                        high={"good": "Sharp nose"}),
    "enemyExecs": dict(num="enemyExecs", den="tracked", label="Gets other team executed (per game)",
                       sides=("good", "evil", "all"), high={"good": "Hound dog", "evil": "The framer", "all": "Closer"}),
    "votes": dict(num="votes", den="tracked", label="Votes per game", sides=("good", "evil", "all")),
    "voteAccuracy": dict(num="votesOnEvil", den="votes", label="Votes on evil", sides=("good",),
                         high={"good": "Sharp voter"}),
}


# ---------- loading ----------
def load_games(path: str | Path, include_excluded: bool = False) -> list[dict]:
    """A Clockwise JSON export (Data & settings → Export → JSON) or the sample data."""
    data = json.loads(Path(path).read_text())
    games = data["games"] if isinstance(data, dict) else data
    if isinstance(games, dict):  # a raw storage dump: id → game
        games = list(games.values())
    return [g for g in games if include_excluded or not g.get("excluded")]


def _find(folder: Path, pattern: str) -> Path:
    found = sorted(folder.glob(pattern))
    if not found:
        raise FileNotFoundError(f"No {pattern} in {folder}")
    return found[-1]  # the latest export if there are several


def load_csv_export(folder: str | Path, include_excluded: bool = False) -> list[dict]:
    """The dashboard's CSV export (games, game_players, nominations, deaths) rebuilt into game records like the JSON.

    The CSVs carry a little less than the JSON: nominations have a day rather than a phase (executions happen in the
    day, so day d is phase 2d), voters are names rather than seats (matched to seats by name within the game), and
    whether the recording started late isn't stored (a death with no day means it did).
    """
    folder = Path(folder)
    read = lambda pat: pd.read_csv(_find(folder, pat), dtype=str, keep_default_na=False)
    G, GP, N, D = read("*games-*.csv"), read("*game_players*.csv"), read("*nominations*.csv"), read("*deaths*.csv")
    tf = lambda v: str(v).lower() == "true"
    num = lambda v: int(float(v)) if str(v).strip() not in ("", "nan") else None
    ms = lambda v: int(pd.Timestamp(v).timestamp() * 1000) if v else None
    games = {}
    for r in G.itertuples(index=False):
        games[r.game_id] = dict(id=r.game_id, community=r.community, endedAt=ms(r.ended_at), startedAt=ms(r.started_at),
                                script={"name": r.script_name, "id": r.script_id}, winner=r.winner, days=num(r.days),
                                storytellers=[{"username": s.strip()} for s in r.storytellers.split(",") if s.strip()],
                                excluded=tf(r.excluded), players=[], nominations=[], deaths=[], joinedAtPhase=0)
    for r in GP.itertuples(index=False):
        g = games.get(r.game_id)
        if not g:
            continue
        day, night = num(r.died_day), tf(r.died_at_night)
        survived = tf(r.survived)
        g["players"].append(dict(seat=num(r.seat), username=r.player, userId=r.user_id or None, roleId=r.role_id, roleName=r.role,
                                 team=r.team or None, alignment=r.alignment or None, isTraveller=tf(r.traveller), survived=survived,
                                 diedPhase=(2 * day - (1 if night else 0)) if day else None, won=tf(r.won)))
        if not survived and not day:
            g["joinedAtPhase"] = 1  # someone died before recording started
    for r in D.itertuples(index=False):
        g = games.get(r.game_id)
        if g:
            ph = num(r.phase)
            g["deaths"].append(dict(seat=num(r.seat), phase=ph, day=num(r.day), atNight=tf(r.at_night) if ph else None))
    for r in N.itertuples(index=False):
        g = games.get(r.game_id)
        if not g:
            continue
        by_name = {p["username"]: p["seat"] for p in g["players"]}
        voters = [{"seat": by_name.get(v.strip()), "username": v.strip()} for v in r.voters.split(", ") if v.strip()]
        day = num(r.day)
        g["nominations"].append(dict(day=day, phase=2 * day if day else None, nominatorSeat=num(r.nominator_seat),
                                     nomineeSeat=num(r.nominee_seat), type=r.type, completed=tf(r.completed),
                                     votes=num(r.votes), majority=num(r.majority), voters=voters))
    return [g for g in games.values() if include_excluded or not g["excluded"]]


def load_any(path: str | Path) -> list[dict]:
    """A folder of CSV exports, or a JSON export / the sample data."""
    path = Path(path)
    return load_csv_export(path) if path.is_dir() else load_games(path)


def player_key(p: dict) -> str | None:
    if p.get("userId"):
        return p["userId"]
    return f"name:{p['username'].lower()}" if p.get("username") else None


INVISIBLE = re.compile("[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]")


# Emoji and other symbols outside the basic plane: matplotlib can't draw them, so charts would show empty boxes.
EMOJI = re.compile("[\U00010000-\U0010FFFF\u2600-\u27BF\uFE0F\u2B00-\u2BFF]")


def clean_name(name: str | None, strip_emoji: bool = True) -> str:
    name = INVISIBLE.sub("", name or "")
    return (EMOJI.sub("", name) if strip_emoji else name).strip() or (name or "").strip()


def display_names(games: list[dict]) -> dict[str, str]:
    """Each account under the name it used most (like the dashboard); invisible characters removed."""
    counts: dict[str, dict[str, int]] = {}
    for g in games:
        for p in g.get("players", []) + g.get("storytellers", []):
            k, n = player_key(p), clean_name(p.get("username"))
            if k and n:
                counts.setdefault(k, {}).setdefault(n, 0)
                counts[k][n] += 1
    return {k: max(m, key=m.get) for k, m in counts.items()}


# ---------- per seat ----------
def _majority_met(n: dict) -> bool:
    v, m = n.get("votes"), n.get("majority")
    return not isinstance(v, (int, float)) or not m or v >= m


def executions(g: dict) -> dict[int, dict]:
    """Seat → {phase, by}: players who died in the day after a nomination of them with enough votes that day."""
    out = {}
    for d in g.get("deaths") or []:
        if d.get("atNight") or not d.get("phase"):
            continue
        noms = [n for n in g.get("nominations") or []
                if n.get("phase") == d["phase"] and n.get("nomineeSeat") == d["seat"] and n.get("type") != "exile"
                and n.get("completed") is not False and _majority_met(n)]
        if noms:
            out[d["seat"]] = {"phase": d["phase"], "by": noms[-1].get("nominatorSeat")}
    return out


def seat_fate(g: dict, p: dict, exec_map: dict) -> str | None:
    if p.get("survived"):
        return "survivedWon" if p.get("won") else "survivedLost"
    phase = p.get("diedPhase")
    if not phase:
        return None  # died before anyone was recording
    day, night = math.ceil(phase / 2), phase % 2 == 1
    e = exec_map.get(p["seat"])
    executed = (not night) and e is not None and e["phase"] == phase
    if executed and day >= (g.get("days") or day):
        return "execFinal"
    if day <= 2:
        return "execEarly" if executed else "killedEarly"
    return "diedLater"


def seat_table(games: list[dict]) -> pd.DataFrame:
    """One row per (non-traveller) player per game, with their fate and nomination/vote counts."""
    names = display_names(games)
    rows = []
    for g in games:
        ex = executions(g)
        by_seat = {p["seat"]: p for p in g["players"]}
        tracked = not g.get("joinedAtPhase")  # nominations only count for games recorded from the start
        for p in g["players"]:
            key = player_key(p)
            if not key or p.get("isTraveller") or p.get("alignment") not in ("good", "evil"):
                continue
            r = dict(game=g["id"], ended=g.get("endedAt"), script=(g.get("script") or {}).get("name"),
                     community=g.get("community"), winner=g.get("winner"), days=g.get("days"),
                     key=key, name=names.get(key, p.get("username")), side=p["alignment"], team=p.get("team"),
                     role=p.get("roleName"), won=bool(p.get("won")), fate=seat_fate(g, p, ex), died_phase=p.get("diedPhase"),
                     tracked=tracked, noms=0, nomsOnEvil=0, enemyExecs=0, votes=0, votesOnEvil=0)
            if tracked:
                for n in g.get("nominations") or []:
                    if n.get("type") == "exile":
                        continue
                    nominee = by_seat.get(n.get("nomineeSeat"))
                    on_evil = bool(nominee and nominee.get("alignment") == "evil")
                    if n.get("nominatorSeat") == p["seat"]:
                        r["noms"] += 1
                        r["nomsOnEvil"] += on_evil
                    if any(v.get("seat") == p["seat"] for v in n.get("voters") or []):
                        r["votes"] += 1
                        r["votesOnEvil"] += on_evil
                for seat, e in ex.items():
                    nominee = by_seat.get(seat)
                    if e["by"] == p["seat"] and nominee and not nominee.get("isTraveller") \
                            and nominee.get("alignment") and nominee["alignment"] != p["alignment"]:
                        r["enemyExecs"] += 1
            rows.append(r)
    return pd.DataFrame(rows)


# ---------- per player ----------
def _tally(seats: pd.DataFrame) -> pd.DataFrame:
    s = seats.copy()
    for f in FATES:
        s[f"f_{f}"] = (s["fate"] == f).astype(int)
    s["known"] = s["fate"].notna().astype(int)
    s["survived"] = s["f_survivedWon"] + s["f_survivedLost"]
    s["games"] = 1
    s["wins"] = s["won"].astype(int)
    s["tracked"] = s["tracked"].astype(int)
    for c in ["noms", "nomsOnEvil", "enemyExecs", "votes", "votesOnEvil"]:
        s[c] = s[c] * s["tracked"]
    cols = ["games", "wins", "known", "survived", "tracked", "noms", "nomsOnEvil", "enemyExecs", "votes", "votesOnEvil"] + [f"f_{f}" for f in FATES]
    return s.groupby(["key", "name"], as_index=False)[cols].sum()


def features_for(side: str) -> list[str]:
    return [f for f, d in FEATURES.items() if side in d["sides"]]


def player_table(seats: pd.DataFrame, side: str = "good", shrink: float = SHRINK) -> pd.DataFrame:
    """Counts, raw rates (raw_<feature>) and shrunk rates (s_<feature>) per player on one side ('good', 'evil' or 'all').

    shrunk = (count + shrink × table-wide rate) / (denominator + shrink): a player with few games is pulled toward
    the average, so luck over a handful of games doesn't look like a style.
    """
    s = seats if side == "all" else seats[seats["side"] == side]
    t = _tally(s)
    pooled = t.drop(columns=["key", "name"]).sum()
    for f in features_for(side):
        d = FEATURES[f]
        den = t[d["den"]]
        pool = pooled[d["num"]] / pooled[d["den"]] if pooled[d["den"]] else np.nan
        t[f"raw_{f}"] = np.where(den > 0, t[d["num"]] / den.replace(0, np.nan), np.nan)
        t[f"s_{f}"] = (t[d["num"]] + shrink * pool) / (den + shrink)
    return t.sort_values("games", ascending=False).reset_index(drop=True)


def feature_matrix(players: pd.DataFrame, side: str = "good", min_games: int | None = None, features: list[str] | None = None):
    """z-scored shrunk rates for players with enough games. Returns (X DataFrame indexed by name, features used).

    features: which rates to use (default: every one that applies to the side). Ones that don't vary are dropped.
    """
    min_games = MIN_GAMES[side] if min_games is None else min_games
    p = players[players["games"] >= min_games]
    wanted = [f for f in (features or features_for(side)) if f in features_for(side)]
    S = p[[f"s_{f}" for f in wanted]].rename(columns=lambda c: c[2:])
    feats = [f for f in S.columns if S[f].std(ddof=0) > 1e-9]
    X = (S[feats] - S[feats].mean()) / S[feats].std(ddof=0)
    X.index = p["name"].values
    return X, feats


# ---------- naming groups (same rule as the dashboard) ----------
def name_groups(centres: pd.DataFrame, side: str) -> list[str]:
    """centres: one row per group, one column per feature (z units). Strongest groups pick their names first."""
    def name_for(f, z):
        d = FEATURES[f]
        if z > 0.3 and side in d.get("high", {}):
            return d["high"][side]
        if z < -0.3 and side in d.get("low", {}):
            return d["low"][side]
        return None
    order = centres.abs().max(axis=1).sort_values(ascending=False).index
    taken, names = set(), {}
    for g in order:
        row = centres.loc[g]
        pick = next((n for f in row.abs().sort_values(ascending=False).index if (n := name_for(f, row[f])) and n not in taken), None)
        names[g] = pick or "Middle of the road"
        taken.add(names[g])
    return [names[g] for g in centres.index]
