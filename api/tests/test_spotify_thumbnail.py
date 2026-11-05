from __future__ import annotations

import unittest

from api.spotify import _album_thumbnail


class AlbumThumbnailTests(unittest.TestCase):
    def test_picks_the_smallest_image(self) -> None:
        track = {
            "album": {
                "images": [
                    {"url": "https://i.scdn.co/640", "width": 640},
                    {"url": "https://i.scdn.co/300", "width": 300},
                    {"url": "https://i.scdn.co/64", "width": 64},
                ]
            }
        }
        self.assertEqual(_album_thumbnail(track), "https://i.scdn.co/64")

    def test_is_none_without_art(self) -> None:
        self.assertIsNone(_album_thumbnail({}))
        self.assertIsNone(_album_thumbnail({"album": {"images": []}}))
        self.assertIsNone(_album_thumbnail({"album": None}))
