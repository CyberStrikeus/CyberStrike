"""Source-owned tests for the LLDB bridge's bounded retention helpers."""

from io import BytesIO
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


fake_lldb = sys.modules.setdefault("lldb", types.ModuleType("lldb"))
fake_lldb.LLDB_INVALID_ADDRESS = -1
fake_lldb.eLaunchFlagDebug = 2
fake_lldb.eLaunchFlagStopAtEntry = 4
fake_lldb.eStateExited = 10
fake_lldb.SBEvent = lambda: object()
spec = importlib.util.spec_from_file_location(
    "rea_lldb_tracer", os.path.join(os.path.dirname(__file__), "rea_lldb_tracer.py")
)
tracer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tracer)


class NativeTraceBudgetTests(unittest.TestCase):
    def test_invalid_launch_process_reports_explicit_no_creation(self):
        class InvalidProcess:
            def IsValid(self):
                return False

            def Kill(self):
                raise AssertionError("an invalid process cannot own target cleanup")

        class LaunchError:
            def Success(self):
                return False

            def GetCString(self):
                return "No such file or directory: fixture/absent"

        class Target:
            def IsValid(self):
                return True

            def Launch(self, _launch_info, _error):
                return InvalidProcess()

        class Debugger:
            def SetAsync(self, _enabled):
                pass

            def GetInstanceName(self):
                return "fixture"

            def CreateTarget(self, *_arguments):
                return Target()

        class Pipe:
            def __init__(self, *_arguments):
                self.closed = False
                pipes.append(self)

            def start(self):
                pass

            def close(self, expected_exit=False):
                self.closed = True

        pipes = []
        debugger_api = types.SimpleNamespace(SetInternalVariable=lambda *_arguments: None)
        with patch.object(tracer.lldb, "SBDebugger", debugger_api, create=True), patch.object(
            tracer.lldb, "SBError", LaunchError, create=True
        ), patch.object(tracer.lldb, "SBListener", lambda _name: object(), create=True), patch.object(
            tracer, "_hash_file", return_value="expected"
        ), patch.object(tracer, "_file_identity", return_value=(1, 2)), patch.object(
            tracer, "_module_identity", return_value=("fixture", (1, 2), "fixture-uuid")
        ), patch.object(tracer, "_launch_info", return_value=object()), patch.object(
            tracer, "_OutputPipe", Pipe
        ):
            result = tracer.trace(Debugger(), {
                "executable": "fixture", "architecture": "arm64", "expected_sha256": "expected",
                "breakpoints": [], "working_directory": "fixture/absent",
                "stdout_path": "stdout", "stdout_capture_path": "stdout-capture",
                "stderr_path": "stderr", "stderr_capture_path": "stderr-capture",
            })
        self.assertEqual(result["status"], "launch-error")
        self.assertEqual(result["error"], "No such file or directory: fixture/absent")
        self.assertIs(result["target_process_created"], False)
        self.assertNotIn("target_process_exit_observed", result)
        self.assertEqual(len(pipes), 2)
        self.assertTrue(all(pipe.closed for pipe in pipes))

    def test_failed_launch_does_not_infer_exit_from_a_failed_kill(self):
        class Process:
            def IsValid(self):
                return True

            def GetProcessID(self):
                return 12345

            def GetState(self):
                return 6

            def Kill(self):
                return None

        class Sink:
            close_exit = None

            def mark_launched(self):
                pass

            def close(self, expected_exit=False):
                self.close_exit = expected_exit

        with tempfile.TemporaryDirectory() as directory:
            stdout, stderr = Sink(), Sink()
            with patch.object(tracer, "_wait_for_identity_ack", return_value="unavailable"), patch.object(
                tracer, "_wait_for_exit", return_value=None
            ):
                exited = tracer._retire_failed_launch(
                    Process(), {"pid_path": os.path.join(directory, "pid")}, object(), stdout, stderr
                )
        self.assertFalse(exited)
        self.assertFalse(stdout.close_exit)
        self.assertFalse(stderr.close_exit)

    def test_failed_launch_publishes_pid_and_retires_live_process(self):
        class Process:
            state = 6
            killed = False

            def IsValid(self):
                return True

            def GetProcessID(self):
                return 12345

            def GetState(self):
                return self.state

            def Kill(self):
                self.killed = True
                self.state = tracer.lldb.eStateExited

        class Sink:
            launched = False
            close_exit = None

            def mark_launched(self):
                self.launched = True

            def close(self, expected_exit=False):
                self.close_exit = expected_exit

        with tempfile.TemporaryDirectory() as directory:
            pid_path = os.path.join(directory, "pid")
            process = Process()
            stdout, stderr = Sink(), Sink()

            def acknowledge(config):
                with open(config["pid_path"], "r") as pid_file:
                    self.assertEqual(pid_file.read(), "12345")
                return "readable"

            with patch.object(tracer, "_wait_for_identity_ack", acknowledge):
                exited = tracer._retire_failed_launch(
                    process,
                    {"pid_path": pid_path},
                    object(),
                    stdout,
                    stderr,
                )

        self.assertTrue(exited)
        self.assertTrue(process.killed)
        self.assertTrue(stdout.launched)
        self.assertTrue(stderr.launched)
        self.assertTrue(stdout.close_exit)
        self.assertTrue(stderr.close_exit)

    def test_failed_launch_records_when_valid_process_is_already_exited(self):
        class Process:
            def IsValid(self):
                return True

            def GetProcessID(self):
                return 12345

            def GetState(self):
                return tracer.lldb.eStateExited

            def Kill(self):
                raise AssertionError("an exited process must not be killed")

        class Sink:
            close_exit = None

            def mark_launched(self):
                raise AssertionError("an exited process has no output to drain")

            def close(self, expected_exit=False):
                self.close_exit = expected_exit

        with tempfile.TemporaryDirectory() as directory:
            pid_path = os.path.join(directory, "pid")
            stdout, stderr = Sink(), Sink()
            with patch.object(
                tracer,
                "_wait_for_identity_ack",
                side_effect=AssertionError("exit is already observed"),
            ):
                exited = tracer._retire_failed_launch(
                    Process(), {"pid_path": pid_path}, object(), stdout, stderr
                )
            with open(pid_path, "r") as pid_file:
                self.assertEqual(pid_file.read(), "12345")

        self.assertTrue(exited)
        self.assertTrue(stdout.close_exit)
        self.assertTrue(stderr.close_exit)

    def test_pre_target_integrity_failure_reports_no_process_created(self):
        original_debugger = getattr(tracer.lldb, "SBDebugger", None)

        class DebuggerApi:
            @staticmethod
            def SetInternalVariable(*_arguments):
                return None

        class Debugger:
            def SetAsync(self, _enabled):
                return None

            def GetInstanceName(self):
                return "fixture"

            def CreateTarget(self, *_arguments):
                raise AssertionError("integrity failure precedes target creation")

        tracer.lldb.SBDebugger = DebuggerApi
        try:
            with patch.object(tracer, "_hash_file", return_value="changed"), patch.object(
                tracer, "_file_identity", return_value=(1, 2)
            ):
                result = tracer.trace(
                    Debugger(),
                    {"executable": "fixture", "expected_sha256": "expected"},
                )
        finally:
            if original_debugger is None:
                del tracer.lldb.SBDebugger
            else:
                tracer.lldb.SBDebugger = original_debugger

        self.assertEqual(result["status"], "target-integrity-error")
        self.assertIs(result["target_process_created"], False)

    def test_journal_checks_exact_byte_budget_before_writing(self):
        record = {"kind": "other-stop", "reason": "signal"}
        encoded_size = len((tracer.json.dumps(record) + "\n").encode("utf-8"))
        stream = BytesIO()
        journal = tracer._ObservationJournal(stream, max_bytes=encoded_size - 1)
        self.assertFalse(journal.append(record))
        self.assertEqual(stream.getvalue(), b"")
        self.assertEqual(journal.bytes, 0)

    def test_journal_appends_each_row_once_and_flushes_it(self):
        class CountingStream(BytesIO):
            writes = 0
            flushes = 0

            def write(self, value):
                self.writes += 1
                return super().write(value)

            def flush(self):
                self.flushes += 1
                return super().flush()

        stream = CountingStream()
        journal = tracer._ObservationJournal(stream)
        journal.append({"kind": "event", "event": {"sequence": 0}})
        journal.append({"kind": "other-stop", "reason": "signal"})
        self.assertEqual((stream.writes, stream.flushes), (2, 2))
        self.assertEqual(journal.bytes, len(stream.getvalue()))

    def test_aggregate_trace_budget_admits_exact_boundary_and_rejects_next_record(self):
        self.assertTrue(
            tracer._can_retain_trace(
                tracer.MAX_TRACE_BYTES - 10,
                tracer.MAX_TRACE_FRAMES - 2,
                10,
                2,
            )
        )
        self.assertFalse(
            tracer._can_retain_trace(
                tracer.MAX_TRACE_BYTES - 10,
                tracer.MAX_TRACE_FRAMES - 2,
                11,
                2,
            )
        )
        self.assertFalse(
            tracer._can_retain_trace(
                tracer.MAX_TRACE_BYTES - 10,
                tracer.MAX_TRACE_FRAMES - 2,
                10,
                3,
            )
        )

    def test_oversized_producer_string_is_rejected_before_serialization(self):
        self.assertTrue(tracer._fits_trace_budget("method", 1024))
        self.assertFalse(tracer._fits_trace_budget("m" * 2048, 1024))
        self.assertGreater(
            tracer._estimated_json_size("🙂"), len('"🙂"'.encode("utf-8"))
        )

    def test_launch_flags_preserve_default_debug_and_stop_at_entry(self):
        class Launch:
            flags = 10

            def GetLaunchFlags(self):
                return self.flags

            def SetLaunchFlags(self, flags):
                self.flags = flags

        launch = Launch()
        tracer._set_launch_flags(launch)
        self.assertEqual(launch.flags, 14)

    def test_output_pipe_counts_all_bytes_and_keeps_only_the_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            fifo = os.path.join(directory, "stdout.fifo")
            capture = os.path.join(directory, "stdout.capture")
            sink = tracer._OutputPipe(fifo, capture, 5)
            sink.start()
            sink.mark_launched()
            writer = os.open(fifo, os.O_WRONLY)
            try:
                for index in range(100):
                    chunk = (b"hello world" if index == 0 else b"x" * 4096)
                    os.write(writer, chunk)
            finally:
                os.close(writer)
            sink.drain()
            sink.close(expected_exit=True)
            with open(capture, "rb") as retained:
                self.assertEqual(retained.read(), b"hello")
            self.assertEqual(sink.bytes, 11 + 99 * 4096)
            self.assertTrue(sink.truncated)
            self.assertTrue(sink.complete)

    def test_output_pipe_reports_incomplete_capture_after_unexpected_close(self):
        with tempfile.TemporaryDirectory() as directory:
            fifo = os.path.join(directory, "stdout.fifo")
            capture = os.path.join(directory, "stdout.capture")
            sink = tracer._OutputPipe(fifo, capture, 5)
            sink.start()
            sink.mark_launched()
            sink.close(expected_exit=False)
            self.assertFalse(sink.complete)
            self.assertTrue(sink.truncated)

    def test_selector_location_report_uses_the_requested_method_type(self):
        class Symbol:
            def IsValid(self):
                return True

            def GetName(self):
                return "+[Greeter shared]"

        class FileSpec:
            def GetFilename(self):
                return "Fixture"

            def __str__(self):
                return "/tmp/Fixture"

        class Module:
            def IsValid(self):
                return True

            def GetFileSpec(self):
                return FileSpec()

        class Address:
            def GetModule(self):
                return Module()

            def GetSymbol(self):
                return Symbol()

            def GetFileAddress(self):
                return 1

            def GetLoadAddress(self, target):
                return 2

        class Location:
            def GetAddress(self):
                return Address()

        class Breakpoint:
            def GetNumLocations(self):
                return 1

            def GetLocationAtIndex(self, index):
                return Location()

        report, locations_truncated = tracer._breakpoint_report(
            object(),
            [[Breakpoint()]],
            {
                "breakpoints": [
                    {
                        "kind": "objc-method",
                        "selector": "shared",
                        "method_type": "instance",
                    }
                ]
            },
        )
        self.assertEqual(report[0]["location_count"], 0)
        self.assertEqual(report[0]["locations"], [])
        self.assertFalse(locations_truncated)

    def test_breakpoint_report_bounds_aggregate_location_json(self):
        tracer.lldb.LLDB_INVALID_ADDRESS = -1
        symbol_name = (
            "-[VeryLongButPlausibleObjectiveCController "
            "performTransactionWithRequestIdentifier:accountContext:"
            "securityPolicy:completionHandler:]"
        )
        module_path = (
            "/Applications/Enterprise Product.app/Contents/Frameworks/"
            "EnterpriseSubsystem.framework/Versions/A/EnterpriseSubsystem"
        )

        class Symbol:
            def IsValid(self):
                return True

            def GetName(self):
                return symbol_name

        class FileSpec:
            def GetFilename(self):
                return "EnterpriseSubsystem"

            def __str__(self):
                return module_path

        class Module:
            def IsValid(self):
                return True

            def GetFileSpec(self):
                return FileSpec()

        class Address:
            def GetModule(self):
                return Module()

            def GetSymbol(self):
                return Symbol()

            def GetFileAddress(self):
                return 0x123456789

            def GetLoadAddress(self, target):
                return 0x7123456789

        class Location:
            def GetAddress(self):
                return Address()

        class Breakpoint:
            def GetNumLocations(self):
                return 64

            def GetLocationAtIndex(self, index):
                return Location()

        breakpoint_count = 1000
        created = [[Breakpoint()] for _ in range(breakpoint_count)]
        config = {"breakpoints": [{"kind": "objc-method"}] * breakpoint_count}
        report, locations_truncated = tracer._breakpoint_report(
            object(), created, config
        )
        retained_bytes = sum(
            len(json.dumps(location).encode("utf-8"))
            + (1 if index > 0 else 0)
            for row in report
            for index, location in enumerate(row["locations"])
        )
        self.assertTrue(locations_truncated)
        self.assertEqual(sum(row["location_count"] for row in report), 64_000)
        self.assertLess(sum(len(row["locations"]) for row in report), 64_000)
        self.assertLessEqual(retained_bytes, tracer.MAX_BREAKPOINT_LOCATION_BYTES)


if __name__ == "__main__":
    unittest.main()
