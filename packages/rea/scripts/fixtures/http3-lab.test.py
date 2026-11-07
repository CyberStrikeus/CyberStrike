"""Lifecycle regressions; these tests do not establish HTTP/3 provider support."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("http3_lab", Path(__file__).with_name("http3-lab.py"))
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class CleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_actions_run_after_multiple_close_failures(self):
        attempted = []
        async def fail():
            attempted.append("failed-close")
            raise RuntimeError("close failed")
        async def audit():
            attempted.append("audit")
        failures = await lab.attempt_all([("one", fail), ("two", fail), ("audit", audit)])
        self.assertEqual(attempted, ["failed-close", "failed-close", "audit"])
        self.assertEqual([name for name, _ in failures], ["one", "two"])

    async def test_partial_setup_keeps_primary_error_and_audits_after_close_failure(self):
        original_serve = lab.serve
        closed = []
        class ClosingServer:
            def __init__(self, server):
                self.server = server
            def close(self):
                self.server.close()
                closed.append(True)
                raise RuntimeError("injected close failure")
        async def serve(*args, **kwargs):
            return ClosingServer(await original_serve(*args, **kwargs))
        async def fail_tcp(*args, **kwargs):
            raise RuntimeError("injected primary setup failure")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "capture"
            with patch.object(lab, "serve", serve), patch.object(lab.asyncio, "start_server", fail_tcp):
                with self.assertRaisesRegex(RuntimeError, "injected primary setup failure") as caught:
                    await lab.run(SimpleNamespace(output=str(root), mitmdump="unused"))
            self.assertEqual(closed, [True])
            self.assertIn("injected close failure", " ".join(caught.exception.__notes__))
            report = json.loads((root / "producer-cleanup.json").read_text())
            self.assertEqual(report["primary_error"], "injected primary setup failure")
            self.assertEqual(report["cleanup_errors"][0]["action"], "quic-server")
            self.assertEqual(report["groups"], [])
            self.assertFalse((root / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
