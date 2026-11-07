"""Source-owned tests for the mitmproxy adapter's record projection."""

import importlib.util
import os
import sys
import types
import unittest
from unittest import mock


def load_capture():
    """Load the adapter with fresh mitmproxy stand-ins scoped to its import."""
    fake_mitmproxy = types.ModuleType("mitmproxy")
    fake_mitmproxy.ctx = types.SimpleNamespace()
    fake_mitmproxy.version = types.SimpleNamespace(VERSION="12.2.3")
    fake_io = types.ModuleType("mitmproxy.io")
    fake_io.tnetstring = types.ModuleType("mitmproxy.io.tnetstring")
    stand_ins = {
        "mitmproxy": fake_mitmproxy,
        "mitmproxy.io": fake_io,
        "mitmproxy.io.tnetstring": fake_io.tnetstring,
    }
    spec = importlib.util.spec_from_file_location(
        "rea_mitmproxy_capture", os.path.join(os.path.dirname(__file__), "capture.py")
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, stand_ins):
        spec.loader.exec_module(module)
    return module


capture = load_capture()


def location(value, scheme=None):
    state = {"response": {"headers": [[b"Location", value]]}}
    if scheme is not None:
        state["request"] = {"scheme": scheme}
    record = capture.project_record(state, [])
    sidecar = next(
        field for field in record["binary_fields"] if field["pointer"] == "/response/headers/0/1"
    )
    return record["reported"]["response"]["headers"][0][1], sidecar, record["redactions"]


class TransportUserinfoTests(unittest.TestCase):
    def test_ignorable_controls_cannot_hide_authority_credentials(self):
        for control in [b"\t", b"\n", b"\r"]:
            for value in [b"https://" + control + b"/user:pass@host/path", b"ht" + control + b"tps://user:" + control + b"pass@host/path"]:
                with self.subTest(value=value):
                    text, sidecar, redactions = location(value, b"https")
                    self.assertNotIn("user", text)
                    self.assertNotIn("pass", text)
                    self.assertEqual(sidecar["state"], "redacted")
                    self.assertEqual(len(redactions), 1)

    def test_mixed_network_separators_remove_credentials(self):
        for prefix in [b"\\\\", b"/\\", b"\\/"]:
            with self.subTest(prefix=prefix):
                text, sidecar, redactions = location(prefix + b"user:pass@host/path", b"https")
                self.assertEqual(text, prefix.decode("ascii") + "host/path")
                self.assertEqual(sidecar["state"], "redacted")
                self.assertEqual(len(redactions), 1)

    def test_non_special_base_keeps_backslashes_inside_network_authorities(self):
        text, sidecar, redactions = location(b"//user\\name:pass@host/x", b"foo")
        self.assertEqual(text, "//host/x")
        self.assertEqual(sidecar["state"], "redacted")
        self.assertEqual(len(redactions), 1)
        text, sidecar, redactions = location(b"/\\invoice@customer", b"foo")
        self.assertEqual(text, "/\\invoice@customer")
        self.assertEqual(sidecar["state"], "retained")
        self.assertEqual(redactions, [])

    def test_native_request_paths_preserve_origin_form_and_redact_absolute_form(self):
        for value in [b"/\\invoice@customer", b"//invoice@customer", b"\\\\invoice@customer"]:
            with self.subTest(value=value):
                record = capture.project_record({"request": {"path": value}}, [])
                self.assertEqual(record["reported"]["request"]["path"], value.decode("ascii"))
                self.assertEqual(record["binary_fields"][0]["state"], "retained")
                self.assertEqual(record["redactions"], [])
        record = capture.project_record({"request": {"path": b"https://user:pass@host/x"}}, [])
        self.assertEqual(record["reported"]["request"]["path"], "https://host/x")
        self.assertEqual(record["binary_fields"][0]["state"], "redacted")

    def test_same_scheme_locations_preserve_relative_path_text_and_bytes(self):
        for value in [b"https:invoice@customer", b"https:/invoice@customer", b"https:\\invoice@customer"]:
            with self.subTest(value=value):
                text, sidecar, redactions = location(value, b"https")
                self.assertEqual(text, value.decode("ascii"))
                self.assertEqual(sidecar["state"], "retained")
                self.assertEqual(redactions, [])

    def test_location_authorities_still_remove_credentials_with_a_base_scheme(self):
        for value, scheme, expected in [
            (b"https://user:pass@host/path", b"https", "https://host/path"),
            (b"https:\\\\user:pass@host/path", b"https", "https:\\\\host/path"),
            (b"https:user:pass@host/path", b"http", "https:host/path"),
        ]:
            with self.subTest(value=value, scheme=scheme):
                text, sidecar, redactions = location(value, scheme)
                self.assertEqual(text, expected)
                self.assertEqual(sidecar["state"], "redacted")
                self.assertEqual(len(redactions), 1)

    def test_backup_location_uses_its_own_request_scheme(self):
        record = capture.project_record({
            "request": {"scheme": b"http"},
            "backup": {
                "request": {"scheme": b"https"},
                "response": {"headers": [[b"Location", b"https:invoice@customer"]]},
            },
        }, [])
        self.assertEqual(record["reported"]["backup"]["response"]["headers"][0][1], "https:invoice@customer")
        self.assertEqual(record["redactions"], [])

    def test_backslash_ends_a_special_scheme_authority(self):
        text, sidecar, redactions = location(b"https://example.test\\part@tail")
        self.assertEqual(text, "https://example.test\\part@tail")
        self.assertEqual(sidecar["state"], "retained")
        self.assertIsNotNone(sidecar["content_base64"])
        self.assertEqual(redactions, [])

    def test_userinfo_before_a_backslash_is_still_removed(self):
        text, sidecar, redactions = location(b"https://user:pw@example.test\\path")
        self.assertEqual(text, "https://example.test\\path")
        self.assertEqual(sidecar["state"], "redacted")
        self.assertEqual(
            redactions,
            [{"pointer": "/response/headers/0/1", "reason": "transport-credential"}],
        )

    def test_ordinary_userinfo_is_removed(self):
        text, _sidecar, _redactions = location(b"https://user:pw@example.test/a@b")
        self.assertEqual(text, "https://example.test/a@b")

    def test_empty_userinfo_marker_is_removed(self):
        self.assertEqual(
            capture.without_userinfo("https://@host"), "https://host"
        )

    def test_special_schemes_skip_leading_slashes_before_userinfo(self):
        for value, expected in [
            (b"https://\\user:pass@host/path", b"https://\\host/path"),
            (b"https:\\\\user:pass@host/path", b"https:\\\\host/path"),
            (b"https:user:pass@host", b"https:host"),
            (b"//\\user:pass@host", b"//\\host"),
        ]:
            with self.subTest(value=value):
                self.assertEqual(capture.without_userinfo(value), expected)
        text, sidecar, redactions = location(b"https://\\user:pass@host/path")
        self.assertEqual(text, "https://\\host/path")
        self.assertEqual(sidecar["state"], "redacted")
        self.assertEqual(len(redactions), 1)

    def test_file_base_keeps_paths_after_the_fixed_network_boundary(self):
        for value in [b"///u@h", b"////u@h"]:
            with self.subTest(value=value):
                text, sidecar, redactions = location(value, b"file")
                self.assertEqual(text, value.decode("ascii"))
                self.assertEqual(sidecar["state"], "retained")
                self.assertIsNotNone(sidecar["content_base64"])
                self.assertEqual(redactions, [])

    def test_file_urls_keep_path_text(self):
        self.assertEqual(capture.without_userinfo("file:///a@b"), "file:///a@b")

    def test_file_urls_reject_userinfo_and_keep_their_source(self):
        # WHATWG rejects an "@" in a file host, so nothing parses as credentials.
        self.assertEqual(
            capture.without_userinfo("file://user:pass@host/x"), "file://user:pass@host/x"
        )
        for value in [b"\\\\user:pass@host/x", b"/\\user:pass@host/x", b"//user:pass@host/x"]:
            with self.subTest(value=value):
                text, sidecar, redactions = location(value, b"file")
                self.assertEqual(text, value.decode("ascii"))
                self.assertEqual(sidecar["state"], "retained")
                self.assertEqual(redactions, [])

    def test_rejected_special_hosts_keep_their_source(self):
        # A rejected host or port fails the whole URL, so it has no userinfo.
        for value in [
            "https:user@%",
            "https://user@",
            "https://user:pass@h^st/x",
            "https://user@ho st/x",
            "https://user@host:99999/x",
            "https://user@host:12a",
            "https://user@[::1",
        ]:
            with self.subTest(value=value):
                self.assertEqual(capture.without_userinfo(value), value)
        text, sidecar, redactions = location(b"https://user:pass@h^st/x", b"https")
        self.assertEqual(text, "https://user:pass@h^st/x")
        self.assertEqual(sidecar["state"], "retained")
        self.assertEqual(redactions, [])

    def test_accepted_special_hosts_still_remove_userinfo(self):
        for value, expected in [
            ("https:user@%41", "https:%41"),
            ("https://user@[::1]:8443/x", "https://[::1]:8443/x"),
            ("https://user@host:/x", "https://host:/x"),
            ("wss://user:pass@host:65535", "wss://host:65535"),
            ("https://user@0x7f.1/", "https://0x7f.1/"),
            ("https://user@1.2.3.4./", "https://1.2.3.4./"),
            ("https://user@4294967295/", "https://4294967295/"),
            ("https://user@1.2.3.08a/", "https://1.2.3.08a/"),
            ("https://user@[::ffff:1.2.3.4]/", "https://[::ffff:1.2.3.4]/"),
        ]:
            with self.subTest(value=value):
                self.assertEqual(capture.without_userinfo(value), expected)

    def test_unicode_hosts_that_may_map_to_accepted_hosts_remove_userinfo(self):
        # UTS #46 maps these to 1.2.3.4; mapping is not modeled, so redact.
        for host in ["%EF%BC%91.2.3.4", "1。2.3.4", "%C2%AD1.2.3.4", "１.2.3.4"]:
            with self.subTest(host=host):
                self.assertEqual(
                    capture.without_userinfo(f"https://user:pw@{host}/"), f"https://{host}/"
                )
        text, sidecar, redactions = location(b"https://user:pw@%EF%BC%91.2.3.4/", b"https")
        self.assertEqual(text, "https://%EF%BC%91.2.3.4/")
        self.assertEqual(sidecar["state"], "redacted")
        self.assertEqual(len(redactions), 1)
        # ASCII rejections still hold for non-ASCII hosts.
        self.assertEqual(capture.without_userinfo("https://user@１^/"), "https://user@１^/")

    def test_trailing_controls_and_spaces_do_not_hide_userinfo(self):
        # WHATWG strips trailing C0 controls and spaces before parsing.
        for suffix in [b" ", b"\x01", b"\x00 \x1f"]:
            with self.subTest(suffix=suffix):
                value = b"https://user:pw@example.test" + suffix
                text, sidecar, redactions = location(value, b"https")
                self.assertEqual(text, "https://example.test" + suffix.decode("latin-1"))
                self.assertEqual(sidecar["state"], "redacted")
                self.assertEqual(len(redactions), 1)

    def test_rejected_ip_literals_keep_their_source(self):
        for value in [
            "https://user:pass@256.256.256.256/path",
            "https://user@1.2.3.4.5/",
            "https://user@1.2.3.09/",
            "https://user@4294967296/",
            "https://user@a.0x/",
            "https://user@1..2/",
            "https://user@1." + "9" * 5000 + "/",
            "https://user@[1::2::3]/",
            "https://user@[::1%25eth0]/",
        ]:
            with self.subTest(value=value[:40]):
                self.assertEqual(capture.without_userinfo(value), value)

    def test_overlong_ports_are_compared_without_numeric_overflow(self):
        # Python 3.11+ refuses int() on decimal strings over 4300 digits.
        accepted = "https://user@host:" + "0" * 5000 + "80/x"
        self.assertEqual(capture.without_userinfo(accepted), "https://host:" + "0" * 5000 + "80/x")
        rejected = "https://user@host:" + "9" * 5000 + "/x"
        self.assertEqual(capture.without_userinfo(rejected), rejected)

    def test_non_special_schemes_keep_backslashes_in_the_authority(self):
        self.assertEqual(capture.without_userinfo("foo://a\\b@host/x"), "foo://host/x")
        self.assertEqual(capture.without_userinfo(b"//a\\b@host"), b"//a\\b@host")


if __name__ == "__main__":
    unittest.main()
