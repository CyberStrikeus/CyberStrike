"""Exercise automatic route discovery and mistakes that break search metadata."""

import contextlib
import errno
from html import unescape
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from textwrap import dedent
from threading import Thread
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import urlopen
import xml.etree.ElementTree as ET

import polib
from website_i18n import Document, build_translations, checked_catalog, extract_catalogs, languages, prose_units, reading_pages, read_runtime


ROOT = Path(__file__).resolve().parent.parent


def load_script(name):
    """Load a repository script without executing its command-line entrypoint."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PREPARE = load_script("prepare-website")
VERIFY = load_script("verify-website")
WEBSITE = load_script("website")
AUDIT = load_script("audit-website-links")


class WebsiteLinkAuditChecks(unittest.TestCase):
    """Check GitHub transport and URL classification without live network access."""

    def test_github_json_is_decoded_as_utf8_under_a_legacy_locale(self):
        # Exercise real subprocess pipe decoding with UTF-8 mode disabled. Only
        # the external gh executable and the default locale are substituted.
        program = dedent('''\
            import importlib.util
            import json
            from pathlib import Path
            import subprocess
            import sys
            from unittest.mock import patch

            scripts = Path(sys.argv[1])
            sys.path.insert(0, str(scripts))
            spec = importlib.util.spec_from_file_location("audit", scripts / "audit-website-links.py")
            audit = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(audit)
            payload = json.dumps({"title": "Release \\u2603"}, ensure_ascii=False).encode("utf-8")
            run = subprocess.run

            def gh(command, **options):
                assert command == ["gh", "api", "repos/example/project"]
                return run([sys.executable, "-c", "import sys; sys.stdout.buffer.write(" + repr(payload) + ")"], **options)

            with patch("locale.getencoding", return_value="cp936"), patch.object(audit.subprocess, "run", side_effect=gh):
                print(json.dumps(audit.github_api("repos/example/project")))
        ''')
        result = subprocess.run(
            [sys.executable, "-X", "utf8=0", "-c", program, str(ROOT / "scripts")],
            capture_output=True, encoding="utf-8", timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"title": "Release \u2603"})

    def test_raw_and_browser_links_resolve_the_same_ref_and_encoded_path(self):
        # Prefix lookalikes must not win, and tags use the same ref/path split.
        references = {
            "repos/example/project/git/matching-refs/heads/topic": [
                {"ref": "refs/heads/topic"},
                {"ref": "refs/heads/topic/nested"},
                {"ref": "refs/heads/topic/nestedness"},
            ],
            "repos/example/project/git/matching-refs/tags/topic": [
                {"ref": "refs/tags/topic/nested/v1"},
            ],
            "repos/example/project/git/matching-refs/heads/topic%2Fnested": [
                {"ref": "refs/heads/topic/nested"},
                {"ref": "refs/heads/topic/nestedness"},
            ],
            "repos/example/project/git/matching-refs/tags/topic%2Fnested": [
                {"ref": "refs/tags/topic/nested/v1"},
            ],
        }
        cases = (
            ("topic/nested/guide%20%23%3F.md", "guide%20%23%3F.md", "topic%2Fnested"),
            ("topic/nested/v1/README.md", "README.md", "topic%2Fnested%2Fv1"),
            ("topic%2Fnested/README.md", "README.md", "topic%2Fnested"),
        )
        for suffix, path, ref in cases:
            endpoint = f"repos/example/project/contents/{path}?ref={ref}"
            responses = {**references, endpoint: {"name": "README.md"}}

            def github_api(target):
                if target not in responses:
                    raise ValueError("gh: Not Found (HTTP 404)")
                return responses[target]

            for base in (
                "https://raw.githubusercontent.com/example/project/",
                "https://github.com/example/project/blob/",
                "https://github.com/example/project/tree/",
            ):
                with self.subTest(url=base + suffix), patch.object(AUDIT, "github_api", side_effect=github_api):
                    report = AUDIT.audit_url((base + suffix, ["fixture.html"]))
                    self.assertEqual(report["status"], "ok")
                    self.assertEqual(report["endpoint"], endpoint)

    def test_plain_refs_and_pinned_commits_keep_their_contents_target(self):
        for ref in ("main", "a" * 40):
            responses = {
                "repos/example/project/git/matching-refs/heads/main": [{"ref": "refs/heads/main"}],
                "repos/example/project/git/matching-refs/tags/main": [],
                f"repos/example/project/contents/README.md?ref={ref}": {"name": "README.md"},
            }
            for base in ("https://raw.githubusercontent.com/example/project/", "https://github.com/example/project/blob/"):
                with self.subTest(ref=ref, base=base), patch.object(AUDIT, "github_api", side_effect=responses.__getitem__):
                    report = AUDIT.audit_url((base + ref + "/README.md", ["fixture.html"]))
                    self.assertEqual(report["status"], "ok")
                    self.assertEqual(report["endpoint"], f"repos/example/project/contents/README.md?ref={ref}")

    def test_missing_contents_and_unavailable_github_probes_remain_distinct(self):
        cases = (
            (ValueError("gh: Not Found (HTTP 404)"), "broken"),
            (ValueError("gh: Forbidden (HTTP 403)"), "unknown"),
            (subprocess.TimeoutExpired(["gh", "api"], 20), "unknown"),
        )
        for failure, status in cases:
            for base in ("https://raw.githubusercontent.com/example/project/", "https://github.com/example/project/blob/"):
                with self.subTest(failure=str(failure), base=base), patch.object(AUDIT, "github_api", side_effect=failure):
                    report = AUDIT.audit_url((base + "a" * 40 + "/missing.md", ["fixture.html"]))
                    self.assertEqual(report["status"], status)
                    self.assertEqual(report["reason"], str(failure))


class WebsiteSearchChecks(unittest.TestCase):
    """Use authored pages and temporary fixtures to check the publishing boundary."""

    def test_sitemap_tracks_added_moved_removed_and_nonindexable_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)

            def page(name, head="", body=""):
                path = site / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"<html><head>{head}</head><body>{body}</body></html>")
                return path

            page("index.html")
            nested = page("guides/new/index.html")
            page(
                "examples/fixture/index.html",
                '<meta name="robots" content="NOINDEX, follow">',
            )
            page("draft.html", '<meta name="googlebot" content="none">')
            page("code & notes.html")
            page("visible/index.html", body='<meta name="robots" content="noindex">')
            (site / "asset.json").write_text("{}")

            def urls():
                with contextlib.redirect_stdout(io.StringIO()):
                    PREPARE.prepare_sitemap(site)
                sitemap = ET.parse(site / "sitemap.xml")
                return {node.text for node in sitemap.findall(".//{*}loc")}

            self.assertEqual(
                urls(),
                {
                    "https://rea.tools/",
                    "https://rea.tools/guides/new/",
                    "https://rea.tools/code%20%26%20notes.html",
                    "https://rea.tools/visible/",
                },
            )
            nested.rename(site / "moved.html")
            self.assertIn("https://rea.tools/moved.html", urls())
            self.assertNotIn("https://rea.tools/guides/new/", urls())
            (site / "moved.html").unlink()
            self.assertNotIn("https://rea.tools/moved.html", urls())

    def test_verifier_rejects_wrong_canonicals_stale_sitemaps_and_missing_previews(
        self,
    ):
        cases = (
            (
                "index.html",
                'rel="canonical" href="https://rea.tools/"',
                'rel="canonical" href="https://morluto.github.io/rea/"',
                "head canonical",
            ),
            (
                "showcase/aegis/index.html",
                'rel="canonical" href="https://rea.tools/showcase/aegis/"',
                'rel="canonical" href="https://rea.tools/"',
                "head canonical",
            ),
            (
                "examples/notes-electron/index.html",
                'content="noindex"',
                'content="index"',
                "must have a head noindex",
            ),
            (
                "sitemap.xml",
                "https://rea.tools/faq/",
                "https://rea.tools/deleted/",
                "each indexable page once",
            ),
            (
                "faq/index.html",
                'name="twitter:card" content="summary_large_image"',
                'name="twitter:card" content="summary"',
                "twitter:card",
            ),
        )
        for name, old, new, message in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                site = Path(directory) / "public"
                shutil.copytree(ROOT / "website/_site", site)
                path = site / name
                source = path.read_text()
                self.assertIn(old, source)
                path.write_text(source.replace(old, new, 1))
                self.assertTrue(
                    any(message in error for error in VERIFY.check_site(site)[3])
                )
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "public"
            shutil.copytree(ROOT / "website/_site", site)
            (site / "assets/social-card.png").unlink()
            self.assertIn(
                "Social preview PNG is missing; run scripts/prepare-website.py",
                VERIFY.check_site(site)[3],
            )


class WebsiteMaintenanceChecks(unittest.TestCase):
    """Exercise contributor edits and the static preview through real consumers."""

    def test_electron_guide_renderer_matches_download(self):
        public = ROOT / "website/public"
        source = (public / "guides/javascript/index.html").read_text(encoding="utf-8")
        document = Document(source)
        blocks = [node for node in document.nodes if node.attrs.get("id") == "notes-renderer-source"]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].tag, "code")
        displayed = unescape(source[blocks[0].open_end:blocks[0].end_start]) + "\n"
        self.assertEqual(displayed, (public / "examples/notes-electron/renderer.js").read_text(encoding="utf-8"))

    def test_contributors_render_from_snapshot_and_reject_drift_without_rewriting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("public", "templates"):
                shutil.copytree(ROOT / "website" / name, root / "website" / name)
            page = root / "website/public/contributors/index.html"
            snapshot = root / "website/public/contributors/people.json"
            data = json.loads(snapshot.read_text())
            people = data["contributors"][:3]
            data["contributors"] = list(reversed(people))
            data["updated"] = "2026-10-15"
            snapshot.write_text(json.dumps(data))
            original = page.read_text()
            with self.assertRaisesRegex(ValueError, "Shared HTML is stale"):
                WEBSITE.sync_pages(root, check=True)
            self.assertEqual(page.read_text(), original)
            WEBSITE.sync_pages(root)
            source = page.read_text()
            doc = Document(source)
            cards = [node for node in doc.nodes if "data-contributor" in node.attrs]
            self.assertEqual([node.attrs["data-contributor"] for node in cards], sorted(
                (person["login"] for person in people), key=str.casefold,
            ))
            links = [node.attrs["href"] for node in doc.nodes if node.attrs.get("class") == "contributor-card"]
            self.assertCountEqual(links, [person["html_url"] for person in people])
            self.assertIn('<time datetime="2026-10-15" translate="no">2026-10-15</time>', source)
            self.assertEqual(WEBSITE.sync_pages(root), [])
            translated_units = [unit[1] for unit in prose_units(source, "contributors/index.html")]
            for person in people:
                self.assertFalse(any(person["login"] in unit for unit in translated_units))

    def test_contributor_refresh_collects_all_pages_and_preserves_snapshot_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "website/public/contributors/people.json"
            snapshot.parent.mkdir(parents=True)
            original = (ROOT / "website/public/contributors/people.json").read_text()
            snapshot.write_text(original)
            people = json.loads(original)["contributors"][:3]
            response = WEBSITE.subprocess.CompletedProcess([], 0, stdout=json.dumps(people[:2]) + "\n" + json.dumps(people[2:]))
            with patch.object(WEBSITE.subprocess, "run", return_value=response) as api:
                WEBSITE.refresh_contributors(root)
            self.assertIn("--paginate", api.call_args.args[0])
            self.assertEqual(json.loads(snapshot.read_text())["contributors"], people)
            self.assertEqual(set(snapshot.parent.iterdir()), {snapshot})
            good = snapshot.read_text()
            for output in (json.dumps(people) + "\n[", json.dumps(people + people), "[]", '{"message":"API error"}'):
                with self.subTest(output=output), patch.object(WEBSITE.subprocess, "run", return_value=WEBSITE.subprocess.CompletedProcess([], 0, stdout=output)):
                    with self.assertRaises(ValueError):
                        WEBSITE.refresh_contributors(root)
                    self.assertEqual(snapshot.read_text(), good)
            with patch.object(WEBSITE.subprocess, "run", side_effect=WEBSITE.subprocess.CalledProcessError(1, ["gh"])):
                with self.assertRaises(WEBSITE.subprocess.CalledProcessError):
                    WEBSITE.refresh_contributors(root)
            self.assertEqual(snapshot.read_text(), good)

    def test_contributor_refresh_preserves_snapshot_and_cleans_staging_on_save_failure(self):
        people = json.loads((ROOT / "website/public/contributors/people.json").read_text())["contributors"][:2]
        response = WEBSITE.subprocess.CompletedProcess([], 0, stdout=json.dumps(people))
        write_text = Path.write_text

        def partial_write(path, text, *args, **kwargs):
            write_text(path, text[:20], *args, **kwargs)
            raise OSError(errno.ENOSPC, "injected partial write", str(path))

        failures = (
            ("partial write", patch.object(
                Path, "write_text", autospec=True, side_effect=partial_write,
            )),
            ("replace", patch.object(
                Path, "replace", autospec=True,
                side_effect=PermissionError(errno.EACCES, "injected replace failure"),
            )),
        )
        for name, failure in failures:
            with self.subTest(failure=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                snapshot = root / "website/public/contributors/people.json"
                snapshot.parent.mkdir(parents=True)
                snapshot.write_bytes(json.dumps({
                    "repository": "morluto/rea", "updated": "2026-10-14", "contributors": people[:1],
                }).encode("utf-8"))
                before = snapshot.read_bytes()
                with patch.object(WEBSITE.subprocess, "run", return_value=response), failure as save:
                    with self.assertRaises(OSError):
                        WEBSITE.refresh_contributors(root)
                self.assertEqual(save.call_count, 1)
                self.assertEqual(snapshot.read_bytes(), before)
                self.assertEqual(set(snapshot.parent.iterdir()), {snapshot})

    def test_contributor_snapshot_rejects_malformed_identity_and_unsafe_links(self):
        original = json.loads((ROOT / "website/public/contributors/people.json").read_text())
        for field, value in (("id", True), ("id", 0), ("login", ""), ("type", "unknown"),
                             ("html_url", "javascript:alert(1)"), ("html_url", "https://github.com.evil.test/person"),
                             ("avatar_url", "https://token@avatars.githubusercontent.com/u/1")):
            with self.subTest(field=field, value=value):
                data = {**original, "contributors": [{**original["contributors"][0], field: value}]}
                with self.assertRaises(ValueError):
                    WEBSITE.checked_contributors(data)

    def test_shared_edits_preserve_body_and_catch_drift_before_rewriting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("public", "templates"):
                shutil.copytree(ROOT / "website" / name, root / "website" / name)
            page = root / "website/public/blog/touhou-reconstruction/index.html"
            original = page.read_text()
            body = original.split('<main id="main"', 1)[1].split("</main>", 1)[0]
            template = root / "website/templates/header.html.tmpl"
            template.write_text(template.read_text().replace("Reverse Engineer Anything", "REA test navigation"))
            with self.assertRaisesRegex(ValueError, "Shared HTML is stale"):
                WEBSITE.sync_pages(root, check=True)
            self.assertEqual(page.read_text(), original)
            WEBSITE.sync_pages(root)
            updated = page.read_text()
            self.assertIn("REA test navigation", updated)
            self.assertEqual(updated.split('<main id="main"', 1)[1].split("</main>", 1)[0], body)
            self.assertEqual(WEBSITE.sync_pages(root), [])
            page.write_text(updated.replace('    <!-- website:header:end -->', '', 1))
            with self.assertRaisesRegex(ValueError, "needs one header region"):
                WEBSITE.sync_pages(root)

    def test_new_page_escapes_metadata_stays_a_draft_and_joins_sitemap_when_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("public", "templates"):
                shutil.copytree(ROOT / "website" / name, root / "website" / name)
            site = root / "website/public"
            WEBSITE.sync_pages(root)
            shutil.copyfile(ROOT / "website/_site/assets/social-card.png", site / "assets/social-card.png")
            PREPARE.prepare_notes_example(site)
            page = WEBSITE.new_page(root, "blog/new-example", 'A <test> & "result"', 'Check "quotes" & <markup>.')
            source = page.read_text()
            self.assertIn('href="../../blog/" aria-current="page"', source)
            self.assertIn('href="../../assets/styles.css"', source)
            self.assertIn("A &lt;test&gt; &amp; &quot;result&quot;", source)
            with self.assertRaisesRegex(ValueError, "Page already exists"):
                WEBSITE.new_page(root, "blog/new-example", "Another page", "Description")
            with self.assertRaises(ValueError):
                WEBSITE.new_page(root, "../outside", "Title", "Description")
            WEBSITE.sync_pages(root, check=True)
            PREPARE.prepare_sitemap(site)
            self.assertNotIn("https://rea.tools/blog/new-example/", (site / "sitemap.xml").read_text())
            page.write_text(source.replace('    <meta name="robots" content="noindex" />\n', ''))
            PREPARE.prepare_sitemap(site)
            self.assertIn("https://rea.tools/blog/new-example/", (site / "sitemap.xml").read_text())
            self.assertEqual(VERIFY.check_site(site)[3], [])

    def test_links_in_prompts_fragments_and_copy_controls_are_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "public"
            shutil.copytree(ROOT / "website/_site", site)
            page = site / "faq/index.html"
            original = page.read_text()
            cases = (
                ('<a href="https://rea.tools/deleted/">Broken</a>', "missing local target"),
                ('<code>https://rea.tools/guides/native/#deleted</code>', "missing HTML fragment"),
                ('<code>https://morluto.github.io/rea/examples/notes-web/</code>', "obsolete website URL"),
                ('<button data-copy="deleted">Copy</button>', "missing copy target"),
                ('<a href="https://[">Malformed</a>', "invalid URL"),
            )
            for inserted, message in cases:
                with self.subTest(message=message):
                    page.write_text(original.replace("</main>", inserted + "</main>", 1))
                    self.assertTrue(any(message in error for error in VERIFY.check_site(site)[3]))

    def test_repository_links_reject_missing_files_and_old_markdown_anchors(self):
        with tempfile.TemporaryDirectory() as directory:
            container = Path(directory)
            root = container / "repository"
            (root / "website/public").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "docs/guide.md").write_text("# Guide\n## Set up REA\n")
            (container / "outside.md").write_text("# Outside\n")
            page = root / "website/README.md"
            page.write_text("[Guide](../docs/guide.md#set-up-rea)\n")
            (root / "website/.venv").mkdir()
            (root / "website/.venv/vendor.md").write_text("[File](missing.md)")
            self.assertEqual(VERIFY.check_repository_links(root), [])
            alias = container / "repository-alias"
            alias.symlink_to(root.resolve(), target_is_directory=True)
            self.assertEqual(VERIFY.check_repository_links(alias), [])
            page.write_text(
                "[Guide](../docs/guide.md#removed)\n"
                "[File](../docs/removed.md)\n"
                "[Escape](../../outside.md)\n"
            )
            errors = VERIFY.check_repository_links(alias)
            self.assertTrue(any("missing Markdown fragment" in error for error in errors))
            self.assertTrue(any("missing repository target" in error for error in errors))
            self.assertTrue(
                any("missing repository target: ../../outside.md" in error for error in errors)
            )

    def test_site_links_accept_directory_aliases_and_still_reject_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "public"
            shutil.copytree(ROOT / "website/_site", site)
            canonical_site = site.resolve()
            alias = Path(directory) / "public-alias"
            alias.symlink_to(canonical_site, target_is_directory=True)
            self.assertEqual(VERIFY.check_site(canonical_site)[3], [])
            self.assertEqual(VERIFY.check_site(alias)[3], [])

            page = canonical_site / "faq/index.html"
            page.write_text(
                page.read_text().replace(
                    "</main>",
                    '<a href="https://rea.tools/../../outside/">Escape</a></main>',
                    1,
                )
            )
            errors = VERIFY.check_site(alias)[3]
            self.assertTrue(
                any("reference leaves the website" in error for error in errors)
            )

    def test_repository_links_accept_aliased_roots_and_reject_escaping_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = (Path(directory) / "repository").resolve()
            (root / "website/public").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / "docs/guide.md").write_text("# Guide\n")
            page = root / "website/README.md"
            page.write_text("[Guide](../docs/guide.md#guide)\n")
            alias = Path(directory) / "repository-alias"
            alias.symlink_to(root, target_is_directory=True)
            self.assertEqual(VERIFY.check_repository_links(root), [])
            self.assertEqual(VERIFY.check_repository_links(alias), [])
            (root.parent / "outside.md").write_text("# Outside\n")
            page.write_text("[Outside](../../outside.md)\n")
            for boundary in (root, alias):
                with self.subTest(boundary=boundary):
                    self.assertEqual(VERIFY.check_repository_links(boundary), [
                        "website/README.md: missing repository target: ../../outside.md"
                    ])

    def test_site_links_preserve_containment_through_aliased_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            site = (Path(directory) / "site").resolve()
            site.mkdir()
            page = site / "index.html"
            page.write_text('<html lang="en"><head><title>Fixture</title><meta name="robots" content="noindex"></head><body><h1>Fixture</h1><a href="guide.html#answer">Guide</a></body></html>')
            (site / "guide.html").write_text('<html lang="en"><head><title>Guide</title><meta name="robots" content="noindex"></head><body><h1 id="answer">Answer</h1></body></html>')
            (site / "sitemap.xml").write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>')
            (site / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://rea.tools/sitemap.xml\n")
            alias = Path(directory) / "site-alias"
            alias.symlink_to(site, target_is_directory=True)
            # The tiny link fixture intentionally omits the social preview.
            expected = ["Social preview PNG is missing; run scripts/prepare-website.py"]
            self.assertEqual(VERIFY.check_site(site)[3], expected)
            self.assertEqual(VERIFY.check_site(alias)[3], expected)
            (site.parent / "outside.html").write_text("<p>Outside</p>")
            page.write_text(page.read_text().replace("guide.html#answer", "../outside.html"))
            for boundary in (site, alias):
                with self.subTest(boundary=boundary):
                    self.assertIn("index.html: reference leaves the website: ../outside.html", VERIFY.check_site(boundary)[3])

    def test_preview_preserves_pages_prefix_for_assets_and_directory_redirects(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "guide").mkdir()
            (site / "guide/index.html").write_text("<h1>Guide</h1>")
            (site / "asset.css").write_text("body { color: black; }")
            for prefix in ("/", "/rea/"):
                with self.subTest(prefix=prefix), ThreadingHTTPServer(("127.0.0.1", 0), WEBSITE.preview_handler(site, prefix)) as server:
                    worker = Thread(target=server.serve_forever, daemon=True)
                    worker.start()
                    try:
                        base = f"http://127.0.0.1:{server.server_port}"
                        with urlopen(base + prefix + "guide?test=1") as response:
                            self.assertEqual(response.url, base + prefix + "guide/?test=1")
                            self.assertEqual(response.read(), b"<h1>Guide</h1>")
                        with urlopen(base + prefix + "asset.css") as response:
                            self.assertIn(b"color: black", response.read())
                        with self.assertRaises(HTTPError) as error:
                            urlopen(base + prefix + "missing")
                        self.assertEqual(error.exception.code, 404)
                        if prefix != "/":
                            with self.assertRaises(HTTPError) as error:
                                urlopen(base + "/guide/")
                            self.assertEqual(error.exception.code, 404)
                    finally:
                        server.shutdown()
                        worker.join()


class WebsiteTranslationChecks(unittest.TestCase):
    """Exercise source edits, translated evidence and language editions at their consumers."""

    def test_language_inventory_preserves_script_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "website/locales").mkdir(parents=True)
            for code in ("ur", "ur-PK", "ur-Latn", "ur-Latn-PK", "hi-Latn"):
                inventory = [
                    {"code": "en", "name": "English", "readme": "README.md", "dir": "ltr"},
                    {"code": code, "name": "Fixture", "readme": f"docs/readme/README_{code}.md", "dir": "ltr"},
                ]
                path = root / "website/locales/languages.json"
                path.write_text(json.dumps(inventory))
                with self.subTest(code=code):
                    self.assertEqual(languages(root), inventory)
            for code in ("ur-latn", "ur-LATN", "ur-PK-Latn", "ur/Latn"):
                inventory[1]["code"] = code
                path.write_text(json.dumps(inventory))
                with self.subTest(code=code), self.assertRaisesRegex(ValueError, "Invalid or duplicate language"):
                    languages(root)

    def test_completed_script_tag_pages_pass_search_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            # check_site canonicalizes its root before collecting page keys.
            site = Path(directory).resolve()
            (site / "assets").mkdir()
            shutil.copyfile(ROOT / "website/_site/assets/social-card.png", site / "assets/social-card.png")
            shutil.copyfile(ROOT / "website/public/robots.txt", site / "robots.txt")
            pages = {}
            for code in ("ur-Latn", "ur-Latn-PK"):
                path = site / code / "index.html"
                path.parent.mkdir()
                url = f"https://rea.tools/{code}/"
                source = dedent(f'''\
                    <!doctype html>
                    <html lang="{code}" dir="ltr">
                    <head>
                      <title>REA ka ta'aruf</title>
                      <meta name="description" content="REA ko samjhein." />
                      <link rel="canonical" href="{url}" />
                      <link rel="alternate" hreflang="{code}" href="{url}" />
                      <meta property="og:type" content="website" />
                      <meta property="og:site_name" content="REA" />
                      <meta property="og:title" content="REA ka ta'aruf" />
                      <meta property="og:description" content="REA ko samjhein." />
                      <meta property="og:url" content="{url}" />
                      <meta property="og:image" content="https://rea.tools/assets/social-card.png" />
                      <meta property="og:image:type" content="image/png" />
                      <meta property="og:image:width" content="1200" />
                      <meta property="og:image:height" content="630" />
                      <meta property="og:image:alt" content="REA" />
                      <meta name="twitter:card" content="summary_large_image" />
                      <meta name="twitter:title" content="REA ka ta'aruf" />
                      <meta name="twitter:description" content="REA ko samjhein." />
                      <meta name="twitter:image" content="https://rea.tools/assets/social-card.png" />
                      <meta name="twitter:image:alt" content="REA" />
                    </head>
                    <body><h1>REA ka ta'aruf</h1></body>
                    </html>
                ''')
                path.write_text(source, encoding="utf-8")
                page = VERIFY.HtmlReferences()
                page.feed(source)
                self.assertFalse(page.translation_fallback)
                self.assertFalse(page.noindex())
                pages[path] = page
            PREPARE.prepare_sitemap(site)
            self.assertEqual(VERIFY.check_search_metadata(site, pages), (2, []))

    @contextlib.contextmanager
    def translated_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("public", "templates", "locales"):
                shutil.copytree(ROOT / "website" / name, root / "website" / name)
            inventory = [item for item in languages(ROOT) if item["code"] in {"en", "zh-CN", "ar"}]
            (root / "website/locales/languages.json").write_text(json.dumps(inventory))
            for item in inventory:
                destination = root / item["readme"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text("# REA\n")
            WEBSITE.sync_pages(root)
            extract_catalogs(root)
            yield root

    def test_source_change_preserves_review_and_excludes_stale_translation_from_search(self):
        with self.translated_project() as root:
            path = root / "website/locales/zh-CN/messages.po"
            catalog = polib.pofile(path)
            old = catalog.find("How do I install REA?", msgctxt="page:faq/index.html")
            old.tcomment = "Reviewed installation wording."
            old_translation = old.msgstr
            catalog.save(path)
            page = root / "website/public/faq/index.html"
            page.write_text(page.read_text().replace("How do I install REA?", "How do I install REA today?"))
            with self.assertRaisesRegex(ValueError, "Translation sources changed"):
                extract_catalogs(root, check=True)
            extract_catalogs(root)
            updated = polib.pofile(path)
            archived = next(entry for entry in updated if entry.obsolete and entry.msgid == old.msgid)
            self.assertEqual((archived.msgstr, archived.tcomment), (old_translation, old.tcomment))
            new = updated.find("How do I install REA today?", msgctxt=old.msgctxt)
            self.assertEqual(new.msgstr, "")
            build_translations(root, root / "website/_site")
            site = root / "website/_site"
            PREPARE.prepare_sitemap(site)
            fallback = VERIFY.HtmlReferences()
            fallback.feed((site / "zh-CN/faq/index.html").read_text())
            self.assertTrue(fallback.translation_fallback)
            self.assertTrue(fallback.noindex())
            self.assertEqual(fallback.lang, "en")
            self.assertNotIn("https://rea.tools/zh-CN/faq/", (site / "sitemap.xml").read_text())
            self.assertNotIn('hreflang="zh-CN"', (site / "faq/index.html").read_text())
            new.msgstr = "现在如何安装 REA？"
            new.flags.append("fuzzy")
            updated.save(path)
            build_translations(root, site)
            self.assertIn('data-translation-fallback="true"', (site / "zh-CN/faq/index.html").read_text())
            new.flags.remove("fuzzy")
            updated.save(path)
            build_translations(root, site)
            PREPARE.prepare_sitemap(site)
            result = (site / "zh-CN/faq/index.html").read_text()
            self.assertIn("现在如何安装 REA？", result)
            self.assertNotIn("data-translation-fallback", result)
            self.assertIn('href="../assets/styles.css"', (site / "zh-CN/index.html").read_text())
            self.assertIn('hreflang="zh-CN"', (site / "faq/index.html").read_text())
            self.assertIn("https://rea.tools/zh-CN/faq/", (site / "sitemap.xml").read_text())

    def test_broken_placeholders_and_inline_markup_fail_before_replacing_preview(self):
        with self.translated_project() as root:
            page = root / "website/public/index.html"
            page.write_text(page.read_text().replace(
                "</main>",
                '<p>Translation test <a href="get-started/">read more</a>.</p></main>',
            ))
            extract_catalogs(root)
            path = root / "website/locales/zh-CN/messages.po"
            catalog = polib.pofile(path)
            entry = catalog.find("Translation test {ph0}read more{ph1}.", msgctxt="page:index.html")
            self.assertIsNotNone(entry)
            entry.msgstr = "翻译测试：{ph0}继续阅读{ph1}。"
            catalog.save(path)
            site = root / "website/_site"
            build_translations(root, site)
            before = (site / "zh-CN/index.html").read_bytes()
            original = entry.msgstr
            for bad, reason in (("丢失链接", "changed placeholders"), ("{ph1}错误的链接{ph0}", "invalid inline markup")):
                with self.subTest(reason=reason):
                    entry.msgstr = bad
                    catalog.save(path)
                    with self.assertRaisesRegex(ValueError, reason):
                        build_translations(root, site)
                    self.assertEqual((site / "zh-CN/index.html").read_bytes(), before)
            entry.msgstr = original
            catalog.save(path)
            (root / "website/locales/languages.json").unlink()
            with self.assertRaisesRegex(ValueError, "Missing languages.json"):
                build_translations(root, site)
            self.assertEqual((site / "zh-CN/index.html").read_bytes(), before)

    def test_runtime_message_drift_and_page_specific_completeness(self):
        with self.translated_project() as root:
            script = root / "website/public/assets/dino-demo.js"
            original = script.read_text()
            script.write_text(original.replace('t("Pause")', 't("Pause game")'))
            self.assertIn("Pause game", read_runtime(root))
            with self.assertRaisesRegex(ValueError, "Translation sources changed"):
                extract_catalogs(root, check=True)
            script.write_text(original.replace('t("Pause")', 't(dynamicMessage)'))
            with self.assertRaisesRegex(ValueError, "one literal message"):
                read_runtime(root)
            script.write_text(original)
            path = root / "website/locales/zh-CN/messages.po"
            catalog = polib.pofile(path)
            catalog.find("Pause", msgctxt="runtime").msgstr = ""
            catalog.save(path)
            site = root / "website/_site"
            build_translations(root, site)
            self.assertIn('data-translation-fallback="true"', (site / "zh-CN/examples/dino-lab/index.html").read_text())
            self.assertNotIn('data-translation-fallback="true"', (site / "zh-CN/faq/index.html").read_text())

    def test_all_readme_editions_preserve_code_targets_downloads_and_reciprocal_routes(self):
        site = ROOT / "website/_site"
        english_pages = reading_pages(ROOT / "website/public")
        for language in languages(ROOT):
            code = language["code"]
            for original in english_pages:
                relative = original.relative_to(ROOT / "website/public")
                path = site / relative if code == "en" else site / code / relative
                with self.subTest(language=code, page=str(relative)):
                    source = original.read_text()
                    translated = path.read_text()
                    def evidence(html):
                        doc = Document(html)
                        return sorted(doc.source[node.start:node.end] for node in doc.nodes if node.tag in {"pre", "code", "kbd"} or node.attrs.get("translate") == "no")
                    self.assertEqual(evidence(source), evidence(translated))
                    parser = VERIFY.HtmlReferences()
                    parser.feed(translated)
                    self.assertEqual(parser.lang, "en" if parser.translation_fallback else code)
                    font_stylesheets = [
                        node.attrs["href"] for node in Document(translated).nodes
                        if node.tag == "link" and node.attrs.get("rel") == "stylesheet"
                        and urlsplit(node.attrs.get("href", "")).netloc == "fonts.googleapis.com"
                    ]
                    self.assertEqual(len(font_stylesheets), int(parser.lang == "ko"))
                    if font_stylesheets:
                        self.assertIn("family=Noto+Sans+KR:wght@100..900", font_stylesheets[0])
                        self.assertIn("&display=swap", font_stylesheets[0])
                    if code != "en" and not parser.translation_fallback:
                        self.assertEqual(parser.direction, language["dir"])
                    if parser.translation_fallback:
                        self.assertTrue(parser.noindex())
                        self.assertNotIn(code, parser.alternates)
                    else:
                        self.assertEqual(parser.alternates[code], WEBSITE.page_url(site, path))
                    english = VERIFY.HtmlReferences()
                    english.feed((site / relative).read_text())
                    self.assertEqual(parser.alternates, english.alternates)
                    self.assertTrue(set(parser.copy_targets) <= parser.ids)
        for fixture in WEBSITE.NOTES_FIXTURES:
            self.assertEqual((site / fixture).read_bytes(), (ROOT / "website/public" / fixture).read_bytes())
        with ThreadingHTTPServer(("127.0.0.1", 0), WEBSITE.preview_handler(site, "/rea/")) as server:
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                base = f"http://127.0.0.1:{server.server_port}/rea/"
                with urlopen(base + "ar/faq?test=1") as response:
                    self.assertEqual(response.url, base + "ar/faq/?test=1")
                    self.assertIn(b'lang="ar"', response.read())
                with urlopen(base + "assets/i18n.js") as response:
                    self.assertIn(b"export function t", response.read())
                with urlopen(base + "examples/notes-example.zip") as response:
                    self.assertEqual(response.read(), (site / "examples/notes-example.zip").read_bytes())
            finally:
                server.shutdown()
                worker.join()

    def test_every_reading_page_loads_theme_before_styles(self):
        site = ROOT / "website/_site"
        english_pages = reading_pages(ROOT / "website/public")
        self.assertTrue(english_pages)
        for language in languages(ROOT):
            code = language["code"]
            for original in english_pages:
                relative = original.relative_to(ROOT / "website/public")
                for path in {original, site / relative if code == "en" else site / code / relative}:
                    with self.subTest(language=code, page=str(path.relative_to(ROOT))):
                        doc = Document(path.read_text())
                        colors = [node for node in doc.nodes if node.tag == "meta" and node.attrs.get("name") == "theme-color"]
                        self.assertEqual(len(colors), 1)
                        self.assertEqual(colors[0].attrs.get("content"), "#ffffff")
                        self.assertNotIn("media", colors[0].attrs)
                        theme = [node for node in doc.nodes if node.tag == "script" and (node.attrs.get("src") or "").endswith("/assets/theme.js")]
                        self.assertEqual(len(theme), 1)
                        for deferred in ("defer", "async", "type"):
                            self.assertNotIn(deferred, theme[0].attrs)
                        stylesheet = next(node for node in doc.nodes if node.tag == "link" and node.attrs.get("rel") == "stylesheet")
                        self.assertLess(theme[0].start, stylesheet.start)
                        toggle = [node for node in doc.nodes if "data-theme-toggle" in node.attrs]
                        self.assertEqual(len(toggle), 1)
                        self.assertEqual(toggle[0].tag, "button")
                        self.assertIn("hidden", toggle[0].attrs)


if __name__ == "__main__":
    unittest.main()
