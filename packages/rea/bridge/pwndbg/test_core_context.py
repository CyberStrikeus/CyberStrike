"""Producer regressions with controlled GDB state, not native debugger qualification."""
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


BRIDGE = Path(__file__).with_name("core_context.py")


class CoreContextTests(unittest.TestCase):
    def inspect(self, failure=None, connection="core", symbols=None, architecture="x86_64-little-endian", objfile="recorded-executable"):
        commands, reads, queries = [], [], []
        state = {"executable": None, "symbols": None, "connection": None}
        gdb = types.ModuleType("gdb")
        gdb.VERSION = "16.3"
        gdb.selected_inferior = lambda: types.SimpleNamespace(
            connection=state["connection"], pid=123)
        gdb.current_progspace = lambda: types.SimpleNamespace(filename=state["symbols"])

        def execute(command, to_string):
            self.assertTrue(to_string)
            commands.append(command)
            if command == failure:
                raise RuntimeError("controlled command failure")
            if command == "exec-file /proc/self/exe":
                state["executable"] = "/proc/self/exe"
            elif command == "core-file ../object.snapshot":
                if state["executable"] is None:
                    reads.append("recorded-executable")
                    state["executable"] = state["symbols"] = "recorded-executable"
                state["connection"] = types.SimpleNamespace(type=connection)
            elif command == "file":
                state["executable"] = None
                state["symbols"] = symbols

        gdb.execute = execute
        pwndbg = types.ModuleType("pwndbg")
        pwndbg.aglib = types.ModuleType("pwndbg.aglib")
        pwndbg.aglib.vmmap = types.ModuleType("pwndbg.aglib.vmmap")
        pwndbg.lib = types.ModuleType("pwndbg.lib")
        pwndbg.lib.version = types.ModuleType("pwndbg.lib.version")
        pwndbg.lib.version.__version__ = "2026.09.15"

        def maps():
            self.assertIsNone(state["executable"], "Helper executable must be discarded before mapping queries")
            queries.append("maps")
            return [types.SimpleNamespace(start=4096, end=8192, offset=0, flags=5, objfile=objfile)]

        pwndbg.aglib.vmmap.get = maps
        modules = {module.__name__: module for module in [
            gdb, pwndbg, pwndbg.aglib, pwndbg.aglib.vmmap, pwndbg.lib, pwndbg.lib.version]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "debugger"
            stage.mkdir()
            plugin = root / "gdbinit.py"
            plugin.write_text("")
            request = stage / "request.json"
            reply = stage / "reply.json"
            request.write_text(json.dumps({"gdbinit": str(plugin), "architecture": architecture, "snapshot_path": str(root / "object.snapshot"), "reply_path": str(reply)}))
            with patch.dict(sys.modules, modules), patch.dict(os.environ, REA_CORE_CONTEXT_REQUEST=str(request)):
                runpy.run_path(str(BRIDGE))
            result = json.loads(reply.read_text())
        return result, commands, reads, queries

    def test_core_load_never_opens_recorded_executable_and_queries_only_after_discard(self):
        result, commands, reads, queries = self.inspect()
        self.assertTrue(result["ok"], result)
        self.assertEqual(reads, [])
        self.assertEqual(queries, ["maps"])
        self.assertEqual(commands[-4:], ["exec-file /proc/self/exe", "set architecture i386:x86-64", "core-file ../object.snapshot", "file"])
        self.assertLess(commands.index("set debug-file-directory ./no-libraries"), commands.index("core-file ../object.snapshot"))
        self.assertIsNone(result["value"]["executable"])
        self.assertEqual(result["value"]["maps"][0]["current_file_identity"], "unknown")

    def test_failed_guard_core_load_or_discard_never_queries_mappings(self):
        for command in ["exec-file /proc/self/exe", "set architecture i386:x86-64", "core-file ../object.snapshot", "file"]:
            with self.subTest(command=command):
                result, commands, reads, queries = self.inspect(failure=command)
                self.assertFalse(result["ok"])
                self.assertEqual(reads, [])
                self.assertEqual(queries, [])
                if command in ["exec-file /proc/self/exe", "set architecture i386:x86-64"]:
                    self.assertNotIn("core-file ../object.snapshot", commands)

    def test_cross_architecture_uses_the_validated_decoder_profile(self):
        result, commands, reads, queries = self.inspect(architecture="aarch64-little-endian")
        self.assertTrue(result["ok"], result)
        self.assertEqual(reads, [])
        self.assertEqual(queries, ["maps"])
        self.assertLess(commands.index("set architecture aarch64"), commands.index("core-file ../object.snapshot"))

    def test_unknown_architecture_refuses_before_loading_core(self):
        result, commands, reads, queries = self.inspect(architecture="unknown")
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "unsupported")
        self.assertNotIn("core-file ../object.snapshot", commands)
        self.assertEqual(reads, [])
        self.assertEqual(queries, [])

    def test_output_limit_message_separates_the_words_and_names_the_limit(self):
        result, _, reads, queries = self.inspect(objfile="m" * (64 * 1024 * 1024))
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "output-limit")
        self.assertNotIn("exceeds64", result["message"])
        self.assertEqual(result["message"], "Complete debugger context exceeds the 64 MiB reply budget.")
        self.assertEqual(reads, [])
        self.assertEqual(queries, ["maps"])

    def test_wrong_connection_or_remaining_symbols_never_queries_mappings(self):
        for options in [{"connection": "native"}, {"symbols": "unexpected-symbols"}]:
            with self.subTest(options=options):
                result, _, reads, queries = self.inspect(**options)
                self.assertFalse(result["ok"])
                self.assertEqual(reads, [])
                self.assertEqual(queries, [])


if __name__ == "__main__":
    unittest.main()
