from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock, patch

from api.track_scoring import (
    rank_candidates,
    score_candidate,
    split_query,
    title_rejected,
    token_ratio,
    version_tag,
)
from api.youtube import search_youtube_api, search_youtube_ytdlp


def entry(
    title: str,
    channel: str = "",
    duration: int = 180,
    vid: str = "vid",
) -> dict:
    return {"id": vid, "title": title, "channel": channel, "duration": duration}


class TitleRejectedTests(unittest.TestCase):
    def test_live_your_life_survives_live_reject(self) -> None:
        self.assertIsNone(
            title_rejected("Rihanna - Live Your Life (Official Audio)", "Rihanna - Live Your Life")
        )

    def test_music_video_is_not_rejected(self) -> None:
        for title in (
            "Lil Yachty - Poland (Official Video)",
            "Lil Yachty - Poland (Official Music Video)",
            "Lil Yachty - Poland [MV]",
        ):
            with self.subTest(title=title):
                self.assertIsNone(title_rejected(title, "Lil Yachty - Poland"))

    def test_longer_version_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Lil Yachty - Poland (LONGER VERSION)", "Lil Yachty - Poland")
        )

    def test_live_at_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Daft Punk - Alive 2007 Live at Coachella", "Daft Punk - Something About Us")
        )

    def test_live_cuts_allowed_when_query_asks_for_live(self) -> None:
        query = "Daft Punk - Something About Us (Live)"
        self.assertIsNone(title_rejected("Daft Punk - Something About Us (Live)", query))
        self.assertIsNone(title_rejected("Something About Us - Live at Coachella", query))

    def test_remix_rejected_unless_asked_for(self) -> None:
        title = "Innerbloom (Lane 8 Remix)"
        self.assertIsNotNone(title_rejected(title, "Rufus Du Sol - Innerbloom"))
        self.assertIsNone(title_rejected(title, "Rufus Du Sol - Innerbloom Lane 8 Remix"))

    def test_reject_words_in_the_track_name_are_allowed(self) -> None:
        for title, query in (
            ("Diana Ross - Chain Reaction (Official Audio)", "Diana Ross - Chain Reaction"),
            ("Tenacious D - Tribute", "Tenacious D - Tribute"),
            ("Sky Ferreira - 24 Hours", "Sky Ferreira - 24 Hours"),
        ):
            with self.subTest(query=query):
                self.assertIsNone(title_rejected(title, query))

    def test_reject_words_inside_other_words_are_not_rejects(self) -> None:
        for title in (
            "Lauryn Hill - Contribute (Official Audio)",
            "Artist - Overreaction (Official Audio)",
            "Artist - Olive At Dawn (Official Audio)",
        ):
            with self.subTest(title=title):
                self.assertIsNone(title_rejected(title, "Artist - Something"))

    def test_version_tag_key_matches_whole_words_only(self) -> None:
        query = "Artist - Song (Lively Mix)"
        self.assertIsNotNone(title_rejected("Song (Live at Wembley)", query))
        self.assertIsNone(title_rejected("Song (Remixes)", "Artist - Song (Remixed)"))

    def test_live_word_in_the_track_name_keeps_live_cuts_rejected(self) -> None:
        self.assertIsNotNone(
            title_rejected("Live Your Life (Live at Wembley)", "Rihanna - Live Your Life")
        )

    def test_radio_edit_not_rejected(self) -> None:
        self.assertIsNone(title_rejected("Innerbloom (Radio Edit)", "Rufus Du Sol - Innerbloom"))


class SplitQueryTests(unittest.TestCase):
    def test_splits_on_spaced_dash_or_colon(self) -> None:
        self.assertEqual(split_query("Artist  -  Track"), ("Artist", "Track"))
        self.assertEqual(split_query("Artist: Track"), ("Artist", "Track"))
        self.assertEqual(split_query("Jay-Z"), ("", "Jay-Z"))

    def test_version_tag_includes_dash_suffix(self) -> None:
        self.assertIn("acoustic", version_tag("Song - Acoustic"))

    def test_long_whitespace_runs_stay_fast(self) -> None:
        padded = " " * 50_000 + "x"
        started = time.perf_counter()
        self.assertEqual(split_query(padded), ("", padded))
        self.assertNotIn("x", version_tag(padded))
        self.assertLess(time.perf_counter() - started, 1.0)


class ScoreCandidateTests(unittest.TestCase):
    def test_music_video_scores_close_to_the_topic_upload(self) -> None:
        query = "Lil Yachty - Poland"
        topic = score_candidate(entry("Poland", "Lil Yachty - Topic", duration=84), query, 84)
        video = score_candidate(
            entry("Lil Yachty - Poland (Official Video)", "Lil Yachty", duration=84), query, 84
        )
        self.assertIsNotNone(video)
        self.assertGreater(topic, video)

    def test_duration_far_off_target_rejected(self) -> None:
        score = score_candidate(
            entry("Poland", "Lil Yachty - Topic", duration=244), "Lil Yachty - Poland", 84
        )
        self.assertIsNone(score)

    def test_accent_folding_matches_uploader(self) -> None:
        score = score_candidate(
            entry("Innerbloom", "RÜFÜS DU SOL - Topic", duration=579),
            "Rufus Du Sol - Innerbloom",
            579,
        )
        self.assertGreaterEqual(score, 100)

    def test_live_penalty_kept_unless_the_query_says_live(self) -> None:
        live = entry("Poland (Live)", "Lil Yachty", duration=84)
        self.assertGreater(
            score_candidate(live, "Lil Yachty - Poland (Live)", 84),
            score_candidate(live, "Lil Yachty - Poland Lively", 84),
        )

    def test_title_words_match_whole_words_only(self) -> None:
        self.assertEqual(token_ratio("party anthem", "Art"), 0.0)
        self.assertEqual(token_ratio("art (official audio)", "Art"), 1.0)

    def test_feat_not_in_query_penalized(self) -> None:
        query = "Lil Yachty - Poland"
        plain = score_candidate(entry("Poland", "Lil Yachty - Topic", duration=84), query, 84)
        feat = score_candidate(
            entry("Poland feat. Some Bootleg Artist", "Random Uploads", duration=84), query, 84
        )
        self.assertGreater(plain, feat)


class RankCandidatesTests(unittest.TestCase):
    def test_plain_track_first_and_rejects_kept_last(self) -> None:
        items = [
            entry("Poland (LONGER VERSION)", "Bootlegger", duration=244, vid="slow"),
            entry("Lil Yachty - Poland (Official Video)", "Lil Yachty", duration=84, vid="video"),
            entry("Poland", "Lil Yachty - Topic", duration=84, vid="topic"),
            entry("Poland - Live at Rolling Loud", "Fan Cam", duration=90, vid="live"),
        ]
        ranked = [item["id"] for item in rank_candidates(items, "Lil Yachty - Poland", 84)]
        self.assertEqual(ranked, ["topic", "video", "live", "slow"])

    def test_closer_length_outranks_a_better_score(self) -> None:
        items = [
            entry("Lil Yachty - Poland (Official Video)", "Lil Yachty", duration=89, vid="video"),
            entry("Poland (Lyrics)", "Lyric Uploads", duration=85, vid="lyrics"),
            entry("Poland", "Lil Yachty - Topic", duration=87, vid="topic"),
        ]
        ranked = [item["id"] for item in rank_candidates(items, "Lil Yachty - Poland", 84)]
        self.assertEqual(ranked, ["lyrics", "topic", "video"])

    def test_score_orders_candidates_within_a_length_group(self) -> None:
        items = [
            entry("Poland (Lyrics)", "Lyric Uploads", duration=84, vid="lyrics"),
            entry("Poland", "Lil Yachty - Topic", duration=86, vid="topic"),
        ]
        ranked = [item["id"] for item in rank_candidates(items, "Lil Yachty - Poland", 84)]
        self.assertEqual(ranked, ["topic", "lyrics"])

    def test_vlog_naming_the_track_loses_to_plain_upload(self) -> None:
        items = [
            entry('When Lil Yachty was recording "Poland"', "Trap Lore", duration=99, vid="vlog"),
            entry("Poland", "lil boat", duration=84, vid="plain"),
            entry("I PERFORMED POLAND IN POLAND 6 TIMES", "lil boat", duration=71, vid="performed"),
        ]
        ranked = rank_candidates(items, "Lil Yachty - Poland", 84)
        self.assertEqual(ranked[0]["id"], "plain")

    def test_view_count_breaks_ties_toward_popular_uploads(self) -> None:
        items = [
            {**entry("Track", "Some Channel", vid="niche"), "view_count": 1_000},
            {**entry("Track", "Some Channel", vid="popular"), "view_count": 11_000_000},
        ]
        ranked = rank_candidates(items, "Artist - Track", 180)
        self.assertEqual(ranked[0]["id"], "popular")

    def test_falls_back_to_duration_order_when_nothing_scores(self) -> None:
        items = [
            entry("Xtal (Live at Some Festival)", duration=300, vid="far"),
            entry("Xtal (Live at Another Festival)", duration=100, vid="near"),
        ]
        ranked = rank_candidates(items, "Aphex Twin - Xtal", 110)
        self.assertEqual([item["id"] for item in ranked], ["near", "far"])
        self.assertEqual([item["id"] for item in items], ["far", "near"])


class SearchYoutubeApiTests(unittest.TestCase):
    def test_ranks_results_and_keeps_the_response_shape(self) -> None:
        search = MagicMock()
        search.json.return_value = {
            "items": [{"id": {"videoId": "live"}}, {"id": {"videoId": "topic"}}]
        }
        videos = MagicMock()
        videos.json.return_value = {
            "items": [
                {
                    "id": "live",
                    "contentDetails": {"duration": "PT1M24S"},
                    "snippet": {"title": "Poland - Live at Rolling Loud", "channelTitle": "Fan Cam"},
                    "statistics": {"viewCount": "50000000"},
                },
                {
                    "id": "topic",
                    "contentDetails": {"duration": "PT1M26S"},
                    "snippet": {"title": "Poland", "channelTitle": "Lil Yachty - Topic"},
                    "statistics": {},
                },
            ]
        }
        client = MagicMock()
        client.get.side_effect = [search, videos]

        items = search_youtube_api(client, "key", "Lil Yachty - Poland", 5, 84)

        self.assertEqual(
            items,
            [
                {"id": "topic", "title": "Poland", "duration": 86},
                {"id": "live", "title": "Poland - Live at Rolling Loud", "duration": 84},
            ],
        )
        self.assertIn("statistics", client.get.call_args_list[1].kwargs["params"]["part"])


class SearchYoutubeYtdlpTests(unittest.TestCase):
    def test_ranks_results_and_keeps_the_response_shape(self) -> None:
        info = {
            "entries": [
                {"id": "live", "title": "Poland - Live at Rolling Loud", "channel": "Fan Cam",
                 "duration": 84, "view_count": 50_000_000},
                {"id": "topic", "title": "Poland", "channel": "Lil Yachty - Topic", "duration": 86},
            ]
        }
        with patch("yt_dlp.YoutubeDL") as youtube_dl:
            youtube_dl.return_value.__enter__.return_value.extract_info.return_value = info
            items = search_youtube_ytdlp("Lil Yachty - Poland", 5, 84)

        self.assertEqual(
            items,
            [
                {"id": "topic", "title": "Poland", "duration": 86},
                {"id": "live", "title": "Poland - Live at Rolling Loud", "duration": 84},
            ],
        )


if __name__ == "__main__":
    unittest.main()
