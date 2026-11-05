"""Ranks "Artist - Track" YouTube search candidates: closest length first, then
how likely each is the plain track (official audio and music videos count)."""

from __future__ import annotations

import bisect
import re
import unicodedata
from typing import Any

# Word-boundary patterns so titles like "Live Your Life" survive.
HARD_REJECT = [
    r"\blive\s+at\b",
    r"\blive\s+from\b",
    r"\blive\s+version\b",
    r"\bunplugged\b",
    r"\blive\s+lounge\b",
    r"\bconcert\b",
    r"\bin\s+session\b",
    r"\bai\b[\w\s]*\b(cover|version|song|remix)\b",
    r"\bcovers?\b",
    r"\bkaraoke\b",
    r"\binstrumentals?\b",
    r"\bacoustic\b",
    r"\bacapella\b",
    r"\bmashups?\b",
    r"\bbass\s+boosted\b",
    r"\breverbs?\b",
    r"\bnightcore\b",
    r"\b8d\b",
    r"\blonger\s+version\b",
    r"\btype\s+beat\b",
    r"\btributes?\b",
    r"\bfull\s+album\b",
    r"\b\d+\s*(hours?|hrs?)\b",
    r"\bmuffled\b",
    r"\breactions?\b",
    r"\bslowed\b",
    r"\bsped\s+up\b",
]

# Rejects dropped when the track's version tag, e.g. "(Live)" or "- Remix", names the key.
QUERY_SENSITIVE = {
    "remix": [r"\bremix(es|ed)?\b"],
    "cover": [r"\bcovers?\b", r"\bai\b[\w\s]*\b(cover|song)\b"],
    "live": [r"\blive\s+at\b", r"\blive\s+from\b", r"\blive\s+version\b",
             r"\bconcert\b", r"\bunplugged\b", r"\blive\s+lounge\b"],
    "instrumental": [r"\binstrumentals?\b"],
    "acoustic": [r"\bacoustic\b"],
    "acapella": [r"\bacapella\b"],
}

# Soft penalties: often still the plain audio, just not the best upload.
PENALTIES = [
    (r"\blive\b", 40),
    (r"\blyrics?\b", 20),
    (r"\bfeat\.?\b|\bft\.", 15),
    (r"radio\s+edit", 25),
    (r"\bextended\b", 10),
]

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
    words = set(re.findall(r"[a-z0-9']+", fold(haystack)))
    return sum(1 for w in toks if w in words) / len(toks)


def split_query(query: str) -> tuple[str, str]:
    """'Artist - Track' -> (artist, track); falls back to ('', query)."""
    parts = [p.strip() for p in re.split(r"\s+-\s+|:\s+", query, maxsplit=1)]
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", query


def version_tag(track: str) -> str:
    """Folded "(Live)" / "[Remix]" groups and " - Acoustic" suffixes of a track name."""
    groups = re.findall(r"[(\[{]([^)\]}]*)[)\]}]", track)
    return fold(" ".join(groups + re.split(r"\s+-\s+", track)[1:]))


def title_rejected(title: str, query: str) -> str | None:
    """Return the reject reason if a title can't be the plain track."""
    q = fold(query)
    tag = version_tag(split_query(query)[1])
    allowed = {
        pat
        for key, patterns in QUERY_SENSITIVE.items()
        if re.search(rf"\b{key}(s|es|ed)?\b", tag)
        for pat in patterns
    }
    t = fold(title)
    rejects = [pat for patterns in QUERY_SENSITIVE.values() for pat in patterns]
    for pat in rejects + HARD_REJECT:
        # A reject word in the query itself is part of the track's name.
        if pat not in allowed and not re.search(pat, q) and re.search(pat, t):
            return f"rejected: {pat}"
    return None


def score_candidate(
    entry: dict[str, Any],
    query: str,
    target_duration: float | None = None,
) -> float | None:
    """Score a candidate as the plain track for a query; None when it can't be."""
    title = (entry.get("title") or "").strip()
    uploader = (entry.get("channel") or "").strip()
    duration = entry.get("duration")
    artist, track = split_query(query)
    q = fold(query)

    if duration is None:
        return None
    if target_duration is not None and abs(duration - target_duration) > MAX_DURATION_DIFF_S:
        return None
    if title_rejected(title, query):
        return None

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

    for pat, penalty in PENALTIES:
        # Skipped when the query has the word too, e.g. "Live Your Life".
        if not re.search(pat, q) and re.search(pat, folded):
            score -= penalty

    return score


def duration_band(duration: float, target_duration: float | None) -> int:
    """Index of the closest-length group a candidate falls in; 0 without a target."""
    if target_duration is None:
        return 0
    return bisect.bisect_left(DURATION_BANDS_S, abs(duration - target_duration))


def rank_candidates(
    items: list[dict[str, Any]],
    query: str,
    target_duration: float | None = None,
) -> list[dict[str, Any]]:
    """Scored candidates by length group then score, then rejected ones by length
    so they can still be picked; only a length sort when nothing scores."""
    def by_duration(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if target_duration is None:
            return list(items)
        return sorted(items, key=lambda item: abs(item["duration"] - target_duration))

    scored: list[tuple[float, dict[str, Any]]] = []
    rejected: list[dict[str, Any]] = []
    for item in items:
        score = score_candidate(item, query, target_duration)
        if score is None:
            rejected.append(item)
        else:
            scored.append((score, item))
    if not scored:
        return by_duration(items)
    scored.sort(key=lambda pair: (duration_band(pair[1]["duration"], target_duration), -pair[0]))
    return [item for _score, item in scored] + by_duration(rejected)
