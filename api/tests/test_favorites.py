from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from api.favorites_db import init_favorites_db, load_favorites, save_favorites
from api.models import FavoriteTrack, FavoritesSyncRequest
from api.routes import favorites as favorites_routes


def _favorite(index: int) -> FavoriteTrack:
    return FavoriteTrack(
        uniqueSongId=f"youtube:{index}",
        title=f"Track {index}",
        artist="Artist",
        duration=180,
        sourceType="youtube",
    )


def _request(count: int) -> FavoritesSyncRequest:
    return FavoritesSyncRequest(
        favorites=[_favorite(index) for index in range(count)]
    )


class FavoritesSyncTests(unittest.TestCase):
    def test_create_accepts_max_favorites(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "favorites.db"
            init_favorites_db(db_path)
            with (
                patch.dict(os.environ, {"ALLOW_FAVORITES_SYNC": "true"}, clear=True),
                patch.object(favorites_routes, "FAVORITES_DB_PATH", db_path),
                patch.object(favorites_routes, "create_unique_code", return_value="max-code"),
            ):
                response = favorites_routes.create_favorites_sync(_request(150))

        payload = json.loads(response.body)
        self.assertEqual(payload["code"], "max-code")
        self.assertEqual(payload["count"], 150)

    def test_create_rejects_more_than_max_favorites(self) -> None:
        with patch.dict(os.environ, {"ALLOW_FAVORITES_SYNC": "true"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                favorites_routes.create_favorites_sync(_request(151))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Too many favorites (max 150).")

    def test_update_accepts_max_favorites(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "favorites.db"
            init_favorites_db(db_path)
            save_favorites(db_path, "max-code", [])
            with (
                patch.dict(os.environ, {"ALLOW_FAVORITES_SYNC": "true"}, clear=True),
                patch.object(favorites_routes, "FAVORITES_DB_PATH", db_path),
            ):
                response = favorites_routes.update_favorites_sync(
                    "max-code",
                    _request(150),
                )

        payload = json.loads(response.body)
        self.assertEqual(payload["code"], "max-code")
        self.assertEqual(payload["count"], 150)

    def test_update_rejects_more_than_max_favorites(self) -> None:
        with patch.dict(os.environ, {"ALLOW_FAVORITES_SYNC": "true"}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                favorites_routes.update_favorites_sync("max-code", _request(151))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Too many favorites (max 150).")

    def test_create_uses_configured_max_favorites(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "favorites.db"
            init_favorites_db(db_path)
            with (
                patch.dict(
                    os.environ,
                    {"ALLOW_FAVORITES_SYNC": "true", "MAX_FAVORITES": "25"},
                    clear=True,
                ),
                patch.object(favorites_routes, "FAVORITES_DB_PATH", db_path),
                patch.object(favorites_routes, "create_unique_code", return_value="max-code"),
            ):
                response = favorites_routes.create_favorites_sync(_request(25))

        payload = json.loads(response.body)
        self.assertEqual(payload["count"], 25)

    def test_create_rejects_more_than_configured_max_favorites(self) -> None:
        with patch.dict(
            os.environ,
            {"ALLOW_FAVORITES_SYNC": "true", "MAX_FAVORITES": "25"},
            clear=True,
        ):
            with self.assertRaises(HTTPException) as raised:
                favorites_routes.create_favorites_sync(_request(26))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "Too many favorites (max 25).")


class FavoriteTrackModelTests(unittest.TestCase):
    def test_play_mode_and_tuning_round_trip(self) -> None:
        # A favorite saved in autocanonizer mode (with anchor-branch tuning)
        # must survive the store → reload cycle intact.
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "favorites.db"
            init_favorites_db(db_path)
            favorite = FavoriteTrack(
                uniqueSongId="youtube:1",
                title="Track",
                artist="Artist",
                duration=180,
                sourceType="youtube",
                tuningParams="jb=1&thresh=30&ab=7",
                playMode="autocanonizer",
            )
            with (
                patch.dict(os.environ, {"ALLOW_FAVORITES_SYNC": "true"}, clear=True),
                patch.object(favorites_routes, "FAVORITES_DB_PATH", db_path),
                patch.object(
                    favorites_routes, "create_unique_code", return_value="rt-code"
                ),
            ):
                favorites_routes.create_favorites_sync(
                    FavoritesSyncRequest(favorites=[favorite])
                )
                stored = load_favorites(db_path, "rt-code")

        assert stored is not None
        self.assertEqual(stored[0]["playMode"], "autocanonizer")
        # the whole tuning string (including the `ab` anchor param) is opaque
        # and round-trips as one modeled field
        self.assertEqual(stored[0]["tuningParams"], "jb=1&thresh=30&ab=7")

    def test_legacy_favorite_without_play_mode_defaults_to_none(self) -> None:
        favorite = FavoriteTrack(
            uniqueSongId="youtube:1", title="Track", artist="Artist"
        )
        self.assertIsNone(favorite.model_dump()["playMode"])

    def test_unknown_fields_are_dropped(self) -> None:
        # extra="ignore": the server stores only the fields it models, so a
        # future/rogue client field never lands in the sync blob.
        parsed = FavoriteTrack.model_validate(
            {
                "uniqueSongId": "youtube:1",
                "title": "Track",
                "artist": "Artist",
                "playMode": "jukebox",
                "somethingNew": "should-be-dropped",
            }
        )
        dumped = parsed.model_dump()
        self.assertNotIn("somethingNew", dumped)
        self.assertEqual(dumped["playMode"], "jukebox")

    def test_invalid_play_mode_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            FavoriteTrack.model_validate(
                {
                    "uniqueSongId": "youtube:1",
                    "title": "Track",
                    "artist": "Artist",
                    "playMode": "bogus-mode",
                }
            )


if __name__ == "__main__":
    unittest.main()
