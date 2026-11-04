"""Ranks YouTube search candidates so the plain studio track comes first.

Queries arrive as "Artist - Track". The Spotify duration, when known, comes
first: candidates are grouped by how close their length is, and the score only
orders candidates within a group. Official audio, "- Topic" channels and music
videos all count as the plain track; live cuts, covers, remixes and re-uploads
(slowed, nightcore, extended loops) are demoted below the rest.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# Word-boundary patterns so titles like "Live Your Life" survive.
HARD_REJECT = [
    r"live\s+at",
    r"live\s+from",
    r"live\s+version",
    r"unplugged",
    r"live\s+lounge",
    r"\bconcert\b",
    r"in\s+session",
    r"\bai\b[\w\s]*\b(cover|version|song|remix)\b",
    r"\bcovers?\b",
    r"karaoke",
    r"instrumental",
    r"acoustic",
    r"acapella",
    r"\bmashups?\b",
    r"bass\s+boosted",
    r"\breverbs?\b",
    r"nightcore",
    r"\b8d\b",
    r"longer\s+version",
    r"type\s+beat",
    r"tribute",
    r"full\s+album",
    r"\b\d+\s*(hours?|hrs?)\b",
    r"muffled",
    r"reaction",
    r"slowed",
    r"sped\s+up",
]

# Rejects dropped when the query itself asks for that kind of track.
QUERY_SENSITIVE = {
    "remix": [r"\bremix(es|ed)?\b"],
    "cover": [r"\bcovers?\b", r"\bai\b[\w\s]*\b(cover|song)\b"],
    "live": [r"live\s+at", r"live\s+from", r"live\s+version",
             r"\bconcert\b", r"unplugged", r"live\s+lounge"],
    "instrumental": [r"instrumental"],
    "acoustic": [r"acoustic"],
    "acapella": [r"acapella"],
}

# Soft penalties: often still the plain audio, just not the best upload.
PENALTIES = [
    (r"\blive\b", 40),
    (r"\blyrics?\b", 20),
    (r"\bfeat\.?\b|\bft\.", 15),
    (r"radio\s+edit", 25),
    (r"\bextended\b", 10),
]

# Penalties dropped when the query itself asks for that version.
QUERY_SENSITIVE_PENALTIES = {
    "live": [r"\blive\b"],
    "lyric": [r"\blyrics?\b"],
    "feat": [r"\bfeat\.?\b|\bft\."],
    "radio": [r"radio\s+edit"],
    "extended": [r"\bextended\b"],
}

STOPWORDS = {
    "the", "a", "an", "and", "of", "feat", "ft", "with", "official",
    "audio", "video", "song", "radio", "edit", "version", "remastered",
}

# Candidates further than this from the Spotify duration can't be the track.
MAX_DURATION_DIFF_S = 20

# Length-difference groups (seconds); a closer group always ranks first.
DURATION_BANDS_S = (2, 5, 10, MAX_DURATION_DIFF_S)


def fold(text: str) -> str:
    """Lowercase and strip accents, so 'rufus' matches 'RÜFÜS'."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def strip_annotations(title: str) -> str:
    """Fold case/accents and drop (parenthetical) [bracketed] groups."""
    return fold(re.sub(r"[(\[{][^)\]}]*[)\]}]", " ", title))


def tokens(phrase: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9']+", fold(phrase))
            if len(w) > 1 and w not in STOPWORDS]


def token_ratio(haystack: str, phrase: str) -> float:
    toks = tokens(phrase)
    if not toks:
        return 0.0
    return sum(1 for w in toks if w in haystack) / len(toks)


def split_query(query: str) -> tuple[str, str]:
    """'Artist - Track' -> (artist, track); falls back to ('', query)."""
    parts = [p.strip() for p in re.split(r"\s+-\s+|:\s+", query, maxsplit=1)]
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", query


def title_rejected(title: str, query: str) -> str | None:
    """Return the reject reason if a title can't be the plain track."""
    q = query.lower()
    allowed = {
        pat
        for key, patterns in QUERY_SENSITIVE.items()
        if re.search(rf"\b{key}", q)
        for pat in patterns
    }
    t = fold(title)
    rejects = [pat for key, patterns in QUERY_SENSITIVE.items() for pat in patterns]
    for pat in rejects + HARD_REJECT:
        if pat not in allowed and re.search(pat, t):
            return f"rejected: {pat}"
    return None


def score_candidate(
    entry: dict[str, Any],
    query: str,
    target_duration: float | None = None,
) -> tuple[float | None, str]:
    """Score a candidate as the plain track for a query.

    Returns (score, reason); score is None when the candidate can't be the
    plain track, with reason saying why.
    """
    title = (entry.get("title") or "").strip()
    uploader = (entry.get("channel") or "").strip()
    duration = entry.get("duration")
    artist, track = split_query(query)
    q = query.lower()

    if duration is None:
        return None, "no duration"
    if target_duration is not None and abs(duration - target_duration) > MAX_DURATION_DIFF_S:
        return None, f"duration {duration}s vs target {round(target_duration)}s"
    reason = title_rejected(title, query)
    if reason:
        return None, reason

    folded = fold(title)
    score = 0.0
    if uploader.endswith("- Topic"):
        score += 100
    if re.search(r"official\s+audio", folded):
        score += 40
    elif re.search(r"\baudio\b", folded):
        score += 10
    if artist:
        artist_toks = tokens(artist)
        if artist_toks and all(w in fold(uploader) for w in artist_toks):
            score += 25
    clean = strip_annotations(title)
    score += token_ratio(clean, track) * 30
    if artist:
        score += token_ratio(clean, artist) * 15
    # Titles that name the track mid-sentence (vlogs, talk clips) carry words
    # the query doesn't account for; a plain upload's title is mostly query words.
    query_toks = set(tokens(query))
    extra = [w for w in tokens(clean) if w not in query_toks]
    score -= min(len(extra) * 8, 40)
    views = entry.get("view_count")
    if isinstance(views, (int, float)):
        if views >= 10_000_000:
            score += 10
        elif views >= 1_000_000:
            score += 5

    skipped = {
        pat
        for word, patterns in QUERY_SENSITIVE_PENALTIES.items()
        if re.search(rf"\b{word}", q)
        for pat in patterns
    }
    for pat, penalty in PENALTIES:
        if pat not in skipped and re.search(pat, folded):
            score -= penalty

    return score, ""


def duration_band(duration: float, target_duration: float | None) -> int:
    """Index of the closest-length group a candidate falls in; 0 without a target."""
    if target_duration is None:
        return 0
    diff = abs(duration - target_duration)
    return next(
        (i for i, limit in enumerate(DURATION_BANDS_S) if diff <= limit),
        len(DURATION_BANDS_S),
    )


def rank_candidates(
    items: list[dict[str, Any]],
    query: str,
    target_duration: float | None = None,
) -> list[dict[str, Any]]:
    """Order candidates so the plain track comes first.

    Scored candidates come first, closest length group first and best score
    within a group. Rejected ones follow (nearest duration first when a target
    is known) so they can still be picked. With nothing scored, the list is
    only sorted by duration.
    """
    def by_duration(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if target_duration is None:
            return list(items)
        return sorted(items, key=lambda item: abs(item["duration"] - target_duration))

    scored: list[tuple[float, dict[str, Any]]] = []
    rejected: list[dict[str, Any]] = []
    for item in items:
        score, _reason = score_candidate(item, query, target_duration)
        if score is None:
            rejected.append(item)
        else:
            scored.append((score, item))
    if not scored:
        return by_duration(items)
    scored.sort(key=lambda pair: (duration_band(pair[1]["duration"], target_duration), -pair[0]))
    return [item for _score, item in scored] + by_duration(rejected)
