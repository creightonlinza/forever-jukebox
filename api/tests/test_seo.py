from __future__ import annotations

import unittest
from xml.etree import ElementTree

from starlette.requests import Request

from api.main import (
    NOINDEX_META,
    SITE_AUTHOR,
    SITE_DESCRIPTION,
    SITE_NAME,
    SITEMAP_PATHS,
    _head_meta,
    _inject_head,
    _parse_track_id,
    _social_meta,
    _track_card,
    robots_txt,
    sitemap_xml,
)

SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def _request(host: str = "example.com", scheme: str = "https") -> Request:
    return Request(
        {
            "type": "http",
            "scheme": scheme,
            "server": (host, 443 if scheme == "https" else 80),
            "path": "/",
            "headers": [(b"host", host.encode())],
            "query_string": b"",
            "root_path": "",
        }
    )


class SitemapTests(unittest.TestCase):
    def test_sitemap_lists_every_configured_page_with_absolute_urls(self) -> None:
        response = sitemap_xml(_request())
        root = ElementTree.fromstring(response.body)

        locs = [el.text for el in root.iter(f"{SITEMAP_NS}loc")]
        expected = [
            "https://example.com"
            if path == "/"
            else f"https://example.com{path}"
            for path, _, _ in SITEMAP_PATHS
        ]
        self.assertEqual(locs, expected)

    def test_sitemap_includes_changefreq_and_priority(self) -> None:
        response = sitemap_xml(_request())
        root = ElementTree.fromstring(response.body)

        urls = root.findall(f"{SITEMAP_NS}url")
        self.assertEqual(len(urls), len(SITEMAP_PATHS))
        for url in urls:
            self.assertIsNotNone(url.find(f"{SITEMAP_NS}changefreq"))
            self.assertIsNotNone(url.find(f"{SITEMAP_NS}priority"))

    def test_sitemap_excludes_bare_listen_redirect(self) -> None:
        response = sitemap_xml(_request())
        body = response.body.decode()

        self.assertNotIn("<loc>https://example.com/listen</loc>", body)

    def test_sitemap_includes_whats_new(self) -> None:
        response = sitemap_xml(_request())
        body = response.body.decode()

        self.assertIn("<loc>https://example.com/whats-new</loc>", body)

    def test_sitemap_content_type_is_xml(self) -> None:
        response = sitemap_xml(_request())
        self.assertIn("application/xml", response.media_type)


class RobotsTests(unittest.TestCase):
    def test_robots_blocks_api_and_cast(self) -> None:
        body = robots_txt(_request()).body.decode()

        self.assertIn("Disallow: /api/", body)
        self.assertIn("Disallow: /cast", body)

    def test_robots_does_not_block_listen(self) -> None:
        # /listen pages must stay crawlable so bots can read the noindex meta tag.
        body = robots_txt(_request()).body.decode()

        self.assertNotIn("Disallow: /listen", body)

    def test_robots_points_at_absolute_sitemap_url(self) -> None:
        body = robots_txt(_request()).body.decode()

        self.assertIn("Sitemap: https://example.com/sitemap.xml", body)

    def test_robots_uses_request_host(self) -> None:
        body = robots_txt(_request(host="forever-jukebox.fly.dev")).body.decode()

        self.assertIn("Sitemap: https://forever-jukebox.fly.dev/sitemap.xml", body)


class HeadInjectionTests(unittest.TestCase):
    def test_injects_snippet_before_head_close(self) -> None:
        html = "<html><head><title>x</title></head><body></body></html>"

        result = _inject_head(html, "<meta name='x' />")

        self.assertIn("<meta name='x' />", result)
        self.assertLess(result.index("<meta name='x' />"), result.index("</head>"))

    def test_falls_back_when_no_head(self) -> None:
        result = _inject_head("<div>no head here</div>", NOINDEX_META)

        self.assertIn(NOINDEX_META, result)


class SocialMetaTests(unittest.TestCase):
    def test_uses_absolute_image_and_page_urls_from_host(self) -> None:
        meta = _social_meta("https://example.com", "https://example.com/search")

        self.assertIn(
            '<meta property="og:image" content="https://example.com/og-image.png" />',
            meta,
        )
        self.assertIn(
            '<meta property="og:url" content="https://example.com/search" />', meta
        )

    def test_image_url_tracks_request_host(self) -> None:
        meta = _social_meta("https://fj-other.example", "https://fj-other.example/")

        self.assertIn("https://fj-other.example/og-image.png", meta)
        self.assertNotIn("forever-jukebox.fly.dev", meta)

    def test_includes_title_description_and_twitter_card(self) -> None:
        meta = _social_meta("https://example.com", "https://example.com/")

        self.assertIn(f'content="{SITE_NAME}"', meta)
        self.assertIn(SITE_DESCRIPTION, meta)
        self.assertIn('<meta name="twitter:card" content="summary_large_image" />', meta)

    def test_declares_image_dimensions(self) -> None:
        meta = _social_meta("https://example.com", "https://example.com/")

        self.assertIn('<meta property="og:image:width" content="1200" />', meta)
        self.assertIn('<meta property="og:image:height" content="630" />', meta)


class HeadMetaTests(unittest.TestCase):
    def test_includes_description_and_author(self) -> None:
        head = _head_meta("https://example.com", "https://example.com/", noindex=False)

        self.assertIn(f'<meta name="description" content="{SITE_DESCRIPTION}" />', head)
        self.assertIn(f'<meta name="author" content="{SITE_AUTHOR}" />', head)

    def test_includes_social_tags(self) -> None:
        head = _head_meta("https://example.com", "https://example.com/", noindex=False)

        self.assertIn("https://example.com/og-image.png", head)

    def test_noindex_only_when_requested(self) -> None:
        without = _head_meta("https://example.com", "https://example.com/", noindex=False)
        with_tag = _head_meta("https://example.com", "https://example.com/", noindex=True)

        self.assertNotIn(NOINDEX_META, without)
        self.assertIn(NOINDEX_META, with_tag)


class ListenCardTests(unittest.TestCase):
    def test_db_failure_degrades_to_default_card(self) -> None:
        from unittest.mock import patch

        from api import main

        with patch.object(main, "get_job", side_effect=RuntimeError("db down")):
            with self.assertLogs(main.logger, level="WARNING"):
                self.assertIsNone(main._listen_card("a" * 32))


class TrackIdParsingTests(unittest.TestCase):
    def test_32_hex_is_a_job_id(self) -> None:
        self.assertEqual(_parse_track_id("a" * 32), ("job", "a" * 32, None))

    def test_provider_prefix_is_a_source(self) -> None:
        self.assertEqual(
            _parse_track_id("soundcloud:user/track"),
            ("source", "soundcloud", "user/track"),
        )

    def test_bare_id_defaults_to_youtube(self) -> None:
        self.assertEqual(_parse_track_id("dQw4w9WgXcQ"), ("source", "youtube", "dQw4w9WgXcQ"))

    def test_unknown_prefix_falls_back_to_youtube(self) -> None:
        self.assertEqual(_parse_track_id("spotify:abc"), ("source", "youtube", "spotify:abc"))


class TrackCardTests(unittest.TestCase):
    def test_title_and_artist_use_em_dash(self) -> None:
        title, description = _track_card("Bohemian Rhapsody", "Queen")

        self.assertEqual(title, "Bohemian Rhapsody — Queen")
        self.assertIn("by Queen", description)
        self.assertIn(SITE_NAME, description)

    def test_blank_artist_is_omitted(self) -> None:
        title, description = _track_card("Untitled", "")

        self.assertEqual(title, "Untitled")
        self.assertNotIn(" by ", description)

    def test_track_title_flows_into_social_tags(self) -> None:
        meta = _social_meta(
            "https://example.com",
            "https://example.com/listen/x",
            title="Song — Artist",
            og_type="music.song",
        )

        self.assertIn('<meta property="og:title" content="Song — Artist" />', meta)
        self.assertIn('<meta name="twitter:title" content="Song — Artist" />', meta)
        self.assertIn('<meta property="og:type" content="music.song" />', meta)


if __name__ == "__main__":
    unittest.main()
