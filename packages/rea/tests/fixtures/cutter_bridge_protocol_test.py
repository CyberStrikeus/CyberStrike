"""Producer-level regression tests for Cutter's authenticated local protocol."""

import hashlib
import hmac
import importlib.util
import json
import os
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


def _install_host_stubs():
    cutter = types.ModuleType("cutter")
    cutter.CutterPlugin = type("CutterPlugin", (), {})
    sys.modules["cutter"] = cutter
    qtcore = types.ModuleType("PySide6.QtCore")
    qtcore.QObject = type("QObject", (), {})
    qtcore.Signal = lambda *_args: types.SimpleNamespace(connect=lambda _handler: None)
    qtcore.QCoreApplication = types.SimpleNamespace(applicationVersion=lambda: "Cutter test host")
    pyside = types.ModuleType("PySide6")
    pyside.QtCore = qtcore
    sys.modules["PySide6"] = pyside
    sys.modules["PySide6.QtCore"] = qtcore


_install_host_stubs()
MODULE_PATH = Path(__file__).parents[2] / "bridge" / "cutter" / "rea_bridge.py"
spec = importlib.util.spec_from_file_location("rea_cutter_bridge_test", MODULE_PATH)
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


def _frame(connection):
    data = bytearray()
    while b"\n" not in data:
        chunk = connection.recv(4096)
        if not chunk:
            raise EOFError("connection closed before a complete test frame")
        data.extend(chunk)
        if len(data) > bridge.MAX_FRAME_BYTES:
            raise AssertionError("oversized test frame")
    line, remainder = bytes(data).split(b"\n", 1)
    if remainder:
        raise AssertionError("unexpected pipelined frame")
    return json.loads(line)


def _send(connection, value):
    connection.sendall(json.dumps(value, separators=(",", ":")).encode() + b"\n")


class Dispatcher:
    generation = 4
    current_file = "/tmp/sample.bin"
    cutter_version = "test"

    def __init__(self):
        self.dispatch = self
        self.commands = []
        self.completed_commands = {}
        self.lock = threading.Lock()
        self.command_started = threading.Event()
        self.finish_command = threading.Event()
        self.status_queued = threading.Event()

    def _read_current_file(self):
        return self.current_file

    def can_accept_command(self):
        return len(self.completed_commands) < bridge.MAX_COMPLETION_RECEIPTS

    def emit(self, request, reply):
        def run():
            kind = request.get("kind")
            if kind == "command":
                self.command_started.set()
            elif kind == "status":
                self.status_queued.set()
            with self.lock:
                if kind == "command":
                    self.finish_command.wait(2)
                self.commands.append(kind)
                if kind == "status":
                    reply.update({"ok": True, "session_id": request["session_id"], "document_generation": self.generation,
                                  "current_file": self.current_file, "cutter_version": self.cutter_version,
                                  "identity_status": "partial", "completed_commands": [
                                      {"request_id": request_id, "execution_state": state}
                                      for request_id, state in self.completed_commands.items()
                                  ]})
                elif kind == "ack":
                    reply.update({"ok": True, "acknowledged": self.completed_commands.pop(request["request_id"], None) is not None})
                else:
                    reply.update({"ok": True, "execution_state": "complete"})
                    if kind == "command" and isinstance(request.get("request_id"), str):
                        self.completed_commands[request["request_id"]] = "complete"
                request["_event"].set()
        threading.Thread(target=run, daemon=True).start()


class ServeDispatcher:
    """Small UI-dispatcher stand-in for real producer/client interoperability."""

    generation = 4
    current_file = "/tmp/cutter-interop-雪.bin"
    cutter_version = "fixture"

    def __init__(self):
        self.dispatch = self
        self.completed_commands = {}
        self.fail_next_ack = False
        self.malformed_next_ack = False
        self.hide_receipts_after_ack_failure = False

    def can_accept_command(self):
        return len(self.completed_commands) < bridge.MAX_COMPLETION_RECEIPTS

    def _read_current_file(self):
        return self.current_file

    def emit(self, request, reply):
        if request.get("kind") == "status":
            reply.update({
                "ok": True,
                "session_id": request["session_id"],
                "document_generation": self.generation,
                "current_file": self.current_file,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "completed_commands": [
                    {"request_id": request_id, "execution_state": state}
                    for request_id, state in self.completed_commands.items()
                ] if not self.hide_receipts_after_ack_failure else [],
            })
        elif request.get("kind") == "ack":
            if self.malformed_next_ack:
                self.malformed_next_ack = False
                reply.update({"ok": True, "session_id": request["session_id"]})
                request["_event"].set()
                return
            if self.fail_next_ack:
                self.fail_next_ack = False
                self.hide_receipts_after_ack_failure = True
                reply.update({"ok": False, "acknowledged": False})
                request["_event"].set()
                return
            reply.update({
                "ok": True,
                "acknowledged": self.completed_commands.pop(request["request_id"], None) is not None,
            })
            self.hide_receipts_after_ack_failure = False
        elif request.get("kind") == "command" and request.get("expected_generation") != self.generation:
            reply.update({
                "ok": False,
                "error": "active-document-generation-changed",
                "execution_state": "not_started",
            })
            self.completed_commands[request["request_id"]] = "not_started"
        elif request.get("kind") == "command" and request.get("command") == "fixture-unknown":
            reply.update({
                "ok": False,
                "error": "fixture-response-lost-after-completion",
                "execution_state": "unknown",
            })
            self.completed_commands[request["request_id"]] = "complete"
        elif request.get("kind") == "command" and request.get("command") == "fixture-fail-ack":
            reply.update({
                "ok": True,
                "output": "ack will fail once",
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "execution_state": "complete",
            })
            self.completed_commands[request["request_id"]] = "complete"
            self.fail_next_ack = True
        elif request.get("kind") == "command" and request.get("command") == "fixture-malformed-ack":
            reply.update({
                "ok": True,
                "output": "ack reply will be malformed once",
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "execution_state": "complete",
            })
            self.completed_commands[request["request_id"]] = "complete"
            self.malformed_next_ack = True
        else:
            reply.update({
                "ok": True,
                "output": 'round-trip: 雪 ☃️ quote=" slash=\\\\ line=\\n tab=\\t',
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "execution_state": "complete",
            })
            if request.get("kind") == "command":
                self.completed_commands[request["request_id"]] = "complete"
        request["_event"].set()


def run_serve_mode():
    server = bridge._BridgeServer(ServeDispatcher())
    server.start()
    try:
        deadline = time.monotonic() + 5
        while not server.descriptor.exists() and time.monotonic() < deadline:
            time.sleep(0.005)
        if not server.descriptor.exists():
            raise RuntimeError("bridge descriptor was not published")
        print("ready", flush=True)
        sys.stdin.buffer.readline()
    finally:
        server.stop()
        server.join(timeout=3)


class ResponseEncodingTest(unittest.TestCase):
    def setUp(self):
        self.server = bridge._BridgeServer.__new__(bridge._BridgeServer)
        self.server.token = "test-token"
        self.server.session_id = str(uuid.uuid4())

    def assert_authenticated_response(self, frame):
        expected = hmac.new(
            self.server.token.encode(),
            f"rea-cutter-response-v2:{self.server.session_id}:{'a' * 64}:{'b' * 64}:{frame['response']}".encode(),
            hashlib.sha256,
        ).hexdigest()
        self.assertTrue(hmac.compare_digest(frame["proof"], expected))
        return json.loads(frame["response"])

    def test_large_mixed_unicode_output_fits_the_authenticated_frame(self):
        for suffix in ("a", "é", "雪", "😀"):
            with self.subTest(suffix=suffix):
                output = "a" * (5 * 1024 * 1024 - 1) + suffix
                value = {"ok": True, "output": output, "execution_state": "complete"}
                encoded = self.server._encode_authenticated_response(value, "a" * 64, "b" * 64)
                self.assertIsNotNone(encoded)
                self.assertLessEqual(len(encoded), bridge.MAX_FRAME_BYTES)
                frame = json.loads(encoded)
                self.assertEqual(self.assert_authenticated_response(frame), value)
        self.assertIsNone(self.server._encode_authenticated_response({
            "ok": True, "output": "😀" * (5 * 1024 * 1024),
            "execution_state": "complete",
        }, "a" * 64, "b" * 64))

    def test_streamed_frame_matches_the_encoded_frame(self):
        value = {
            "ok": True,
            "output": 'say "hi"\\\n雪\u2028',
            "execution_state": "complete",
        }
        encoded = self.server._encode_authenticated_response(value, "a" * 64, "b" * 64)
        sender, receiver = socket.socketpair()
        try:
            receiver.settimeout(2)
            self.server._send_authenticated(sender, value, "a" * 64, "b" * 64)
            sender.shutdown(socket.SHUT_WR)
            streamed = bytearray()
            while True:
                part = receiver.recv(65536)
                if not part:
                    break
                streamed.extend(part)
        finally:
            sender.close()
            receiver.close()
        self.assertEqual(bytes(streamed), encoded)
        self.assertEqual(json.loads(json.loads(encoded)["response"]), value)

    def test_json_pieces_stay_within_one_chunk(self):
        output = 'say "hi"\\\n雪\u0001' * 20000
        self.assertGreater(len(output), bridge._JSON_CHUNK_CHARS)
        value = {"ok": True, "output": output, "execution_state": "complete"}
        pieces = list(bridge._response_fragments(value))
        self.assertGreater(len(pieces), 4)
        for piece in pieces:
            self.assertLessEqual(len(piece), bridge._JSON_CHUNK_CHARS * 6)
        self.assertEqual(
            "".join(pieces),
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        )

    def test_scalar_lists_are_batched_and_match_json(self):
        mixed = [0, True, False, None, -2, 1.5, {"n": 1}, "ab", [3, 4]]
        self.assertEqual(
            "".join(bridge._response_fragments(mixed)),
            json.dumps(mixed, ensure_ascii=False, separators=(",", ":")),
        )
        zeroes = [0] * 40000
        pieces = list(bridge._response_fragments(zeroes))
        self.assertEqual(
            "".join(pieces),
            json.dumps(zeroes, separators=(",", ":")),
        )
        self.assertLess(len(pieces), 8)
        self.assertGreater(len(pieces), 2)
        for piece in pieces:
            self.assertLessEqual(len(piece), bridge._JSON_CHUNK_CHARS + 1)

    def test_unencodable_output_preserves_authenticated_completion(self):
        for index, surrogate in ((0, "\ud800"), (5 * 1024 * 1024 - 1, "\udfff")):
            with self.subTest(index=index):
                output = "a" * index + surrogate + "a" * (5 * 1024 * 1024 - index - 1)
                value = {"ok": True, "output": output, "execution_state": "complete"}
                sender, receiver = socket.socketpair()
                with sender, receiver:
                    receiver.settimeout(2)
                    self.server._send_authenticated(sender, value, "a" * 64, "b" * 64)
                    response = self.assert_authenticated_response(_frame(receiver))
                self.assertTrue(response["ok"])
                self.assertEqual(response["execution_state"], "complete")
                self.assertIsNone(response["output"])
                self.assertTrue(response["output_truncated"])


class DocumentIdentityTest(unittest.TestCase):
    def test_document_config_drives_generation_and_command_admission(self):
        first = "/tmp/Cutter 雪 #1?.elf"
        second = "/tmp/another document.elf"
        configuration = {"file.path": first}
        core = types.SimpleNamespace(
            getConfig=configuration.__getitem__,
        )
        commands = []
        with patch.object(bridge.cutter, "core", lambda: core, create=True), patch.object(
            bridge.cutter, "cmd", lambda command: commands.append(command) or "observed", create=True
        ):
            dispatcher = bridge._RequestDispatcher()
            self.assertEqual(dispatcher.current_file, first)
            self.assertEqual(dispatcher.generation, 0)

            def handle(**values):
                request = {**values, "_event": threading.Event(), "_cancelled": threading.Event()}
                reply = {}
                dispatcher._handle(request, reply)
                self.assertTrue(request["_event"].is_set())
                return reply

            same = handle(kind="status")
            self.assertEqual(same["current_file"], first)
            self.assertEqual(same["document_generation"], 0)
            configuration["file.path"] = second
            changed = handle(kind="status")
            self.assertEqual(changed["current_file"], second)
            self.assertEqual(changed["document_generation"], 1)
            stale = handle(kind="command", request_id=str(uuid.uuid4()), expected_generation=0, command="iI")
            self.assertEqual(stale["error"], "active-document-generation-changed")
            self.assertEqual(stale["execution_state"], "not_started")
            self.assertEqual(commands, [])
            current = handle(kind="command", request_id=str(uuid.uuid4()), expected_generation=1, command="iI")
            self.assertEqual(current["output"], "observed")
            self.assertEqual(current["document_generation"], 1)
            self.assertEqual(commands, ["iI"])

    def test_absent_or_unreadable_document_config_remains_unknown(self):
        class UnreadableCore:
            def getConfig(self, _key):
                raise RuntimeError("document config unavailable")

        for core in [
            types.SimpleNamespace(getConfig=lambda _key: ""),
            types.SimpleNamespace(getConfig=lambda _key: None),
            types.SimpleNamespace(getConfig=lambda _key: object()),
            types.SimpleNamespace(),
            UnreadableCore(),
        ]:
            with self.subTest(core=type(core).__name__), patch.object(
                bridge.cutter, "core", lambda: core, create=True
            ):
                self.assertIsNone(bridge._RequestDispatcher._read_current_file())


class HostVersionTest(unittest.TestCase):
    def test_host_version_reaches_status_and_command_without_backend_attribution(self):
        backend_reads = []
        core = types.SimpleNamespace(
            getConfig=lambda _key: None,
            getVersionInformation=lambda: backend_reads.append(True) or "Rizin 0.9.1",
        )
        application = sys.modules["PySide6.QtCore"].QCoreApplication
        with patch.object(bridge.cutter, "core", lambda: core, create=True), patch.object(
            application, "applicationVersion", return_value="2.5.0-HEAD-fixture"
        ), patch.object(bridge.cutter, "cmd", lambda _command: "observed", create=True):
            dispatcher = bridge._RequestDispatcher()
            self.assertEqual(dispatcher.cutter_version, "2.5.0-HEAD-fixture")
            for values in [
                {"kind": "status"},
                {"kind": "command", "request_id": str(uuid.uuid4()), "expected_generation": 0, "command": "iI"},
            ]:
                request = {**values, "_event": threading.Event(), "_cancelled": threading.Event()}
                reply = {}
                dispatcher._handle(request, reply)
                self.assertTrue(request["_event"].is_set())
                self.assertEqual(reply["cutter_version"], "2.5.0-HEAD-fixture")
            self.assertEqual(backend_reads, [])

    def test_unavailable_host_version_stays_unknown_without_backend_fallback(self):
        core = types.SimpleNamespace(
            getConfig=lambda _key: None,
            getVersionInformation=lambda: "Rizin 0.9.1",
        )
        application = sys.modules["PySide6.QtCore"].QCoreApplication
        with patch.object(bridge.cutter, "core", lambda: core, create=True):
            for value in ["", None, object()]:
                with self.subTest(value=type(value).__name__), patch.object(
                    application, "applicationVersion", return_value=value
                ):
                    self.assertIsNone(bridge._RequestDispatcher().cutter_version)
            with patch.object(application, "applicationVersion", side_effect=RuntimeError("host unavailable")):
                self.assertIsNone(bridge._RequestDispatcher().cutter_version)


class ProtocolProducerTest(unittest.TestCase):
    def test_stalled_hello_does_not_block_the_next_client(self):
        stalled = socket.create_connection(("127.0.0.1", self.server.port), timeout=2)
        try:
            _send(stalled, {"kind": "rea-auth-v2", "nonce": "b" * 64})
            challenge = _frame(stalled)
            self.assertEqual(challenge["session_id"], self.server.session_id)
            started = time.monotonic()
            response, _nonce = self.exchange({
                "kind": "status",
                "session_id": self.server.session_id,
            })
            self.assertLess(time.monotonic() - started, 2)
            self.assertTrue(response["ok"])
            self.assertEqual(response["session_id"], self.server.session_id)
        finally:
            stalled.close()

    def test_status_does_not_complete_an_earlier_connection_still_reading(self):
        earlier = socket.create_connection(("127.0.0.1", self.server.port), timeout=2)
        try:
            _send(earlier, {"kind": "rea-auth-v2", "nonce": "c" * 64})
            challenge = _frame(earlier)
            earlier_ordinal = challenge["nonce"][:16]
            self.assertEqual(earlier_ordinal, "0000000000000001")
            response, _nonce = self.exchange({
                "kind": "status",
                "session_id": self.server.session_id,
            })
            self.assertEqual(response["completed_connection"], "0" * 16)
        finally:
            earlier.close()
        deadline = time.monotonic() + 2
        latest = "0" * 16
        while time.monotonic() < deadline:
            response, _nonce = self.exchange({
                "kind": "status",
                "session_id": self.server.session_id,
            })
            latest = response["completed_connection"]
            if latest >= earlier_ordinal:
                break
            time.sleep(0.02)
        self.assertGreaterEqual(latest, earlier_ordinal)

    def test_worker_admission_is_bounded_and_keeps_listening(self):
        previous = bridge.MAX_CONNECTION_WORKERS
        bridge.MAX_CONNECTION_WORKERS = 1
        stalled = socket.create_connection(("127.0.0.1", self.server.port), timeout=2)
        try:
            _send(stalled, {"kind": "rea-auth-v2", "nonce": "d" * 64})
            self.assertEqual(_frame(stalled)["session_id"], self.server.session_id)
            rejected = socket.create_connection(("127.0.0.1", self.server.port), timeout=2)
            try:
                rejected.settimeout(1)
                try:
                    observed = rejected.recv(16)
                except (ConnectionResetError, ConnectionAbortedError):
                    observed = b""
                self.assertEqual(observed, b"")
            finally:
                rejected.close()
        finally:
            stalled.close()
            bridge.MAX_CONNECTION_WORKERS = previous
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and any(
            worker.is_alive() for worker in self.server._workers
        ):
            time.sleep(0.01)
        response, _nonce = self.exchange({
            "kind": "status",
            "session_id": self.server.session_id,
        })
        self.assertTrue(response["ok"])
        self.assertTrue(self.server.descriptor.exists())

    def test_failed_worker_start_does_not_stop_the_listener(self):
        calls = {"n": 0}
        original = threading.Thread.start

        def start(thread):
            if thread.name == "rea-cutter-bridge-connection":
                calls["n"] += 1
                if calls["n"] == 1:
                    raise RuntimeError("cannot start new thread")
            return original(thread)

        with patch.object(threading.Thread, "start", start):
            rejected = socket.create_connection(("127.0.0.1", self.server.port), timeout=2)
            try:
                rejected.settimeout(1)
                try:
                    observed = rejected.recv(16)
                except (ConnectionResetError, ConnectionAbortedError):
                    observed = b""
                self.assertEqual(observed, b"")
            finally:
                rejected.close()
        self.assertTrue(self.server.descriptor.exists())
        response, _nonce = self.exchange({
            "kind": "status",
            "session_id": self.server.session_id,
        })
        self.assertTrue(response["ok"])
        self.assertEqual(response["completed_connection"], "0000000000000001")

    def test_rejects_legacy_peers_before_ui_dispatch(self):
        with socket.create_connection(("127.0.0.1", self.server.port), timeout=2) as connection:
            connection.sendall((json.dumps({"kind": "rea-auth-v1", "nonce": "a" * 64}) + "\n").encode())
            with connection.makefile("rb") as reader:
                reply = json.loads(reader.readline())
        self.assertEqual(reply, {"ok": False, "error": "authentication-failed"})
        self.assertEqual(self.dispatcher.commands, [])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        os.environ["REA_CUTTER_BRIDGE_DIR"] = self.temp.name
        self.dispatcher = Dispatcher()
        self.server = bridge._BridgeServer(self.dispatcher)
        bridge.SOCKET_TIMEOUT_SECONDS = 0.1
        self.server.start()
        deadline = time.monotonic() + 2
        while not self.server.descriptor.exists() and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertTrue(self.server.descriptor.exists())

    def tearDown(self):
        self.server.stop()
        self.server.join(timeout=2)
        os.environ.pop("REA_CUTTER_BRIDGE_DIR", None)
        self.temp.cleanup()

    def exchange(self, request):
        token = self.server.token.encode()
        client_nonce = os.urandom(32).hex()
        with socket.create_connection(("127.0.0.1", self.server.port), timeout=1) as connection:
            _send(connection, {"kind": "rea-auth-v2", "nonce": client_nonce})
            challenge = _frame(connection)
            self.assertEqual(challenge["session_id"], self.server.session_id)
            server_nonce = challenge["nonce"]
            expected_server = hmac.new(token, f"rea-cutter-server-v2:{self.server.session_id}:{client_nonce}:{server_nonce}".encode(), hashlib.sha256).hexdigest()
            self.assertTrue(hmac.compare_digest(challenge["proof"], expected_server))
            request_bytes = json.dumps(request, separators=(",", ":"))
            proof = hmac.new(token, f"rea-cutter-client-v2:{self.server.session_id}:{client_nonce}:{server_nonce}:{request_bytes}".encode(), hashlib.sha256).hexdigest()
            _send(connection, {"request": request_bytes, "proof": proof})
            frame = _frame(connection)
            if "response" not in frame:
                return frame, client_nonce
            response = frame["response"]
            expected_response = hmac.new(token, f"rea-cutter-response-v2:{self.server.session_id}:{client_nonce}:{server_nonce}:{response}".encode(), hashlib.sha256).hexdigest()
            self.assertTrue(hmac.compare_digest(frame["proof"], expected_response))
            return json.loads(response), client_nonce

    def test_request_session_uuid_is_checked_after_secret_proof(self):
        spoofed = {"kind": "status", "session_id": "client-chosen-session"}
        response, _ = self.exchange(spoofed)
        self.assertEqual(response["error"], "authentication-failed")
        self.assertEqual(self.dispatcher.commands, [])

    def test_client_chosen_session_uuid_without_secret_proof_is_not_authenticated(self):
        client_nonce = os.urandom(32).hex()
        with socket.create_connection(("127.0.0.1", self.server.port), timeout=1) as connection:
            _send(connection, {"kind": "rea-auth-v2", "nonce": client_nonce})
            _frame(connection)
            request_bytes = json.dumps({"kind": "status", "session_id": "client-chosen-session"}, separators=(",", ":"))
            _send(connection, {"request": request_bytes, "proof": "0" * 64})
            self.assertEqual(_frame(connection)["error"], "authentication-failed")
        self.assertEqual(self.dispatcher.commands, [])

    def test_cancelled_command_receipt_survives_later_command_until_acknowledged(self):
        dispatcher = object.__new__(bridge._RequestDispatcher)
        dispatcher.generation = 4
        dispatcher.current_file = "/tmp/sample.bin"
        dispatcher.cutter_version = "test"
        dispatcher.completed_commands = {}
        dispatcher._receipt_lock = threading.Lock()
        dispatcher._refresh_document_identity = lambda: None
        bridge.cutter.cmd = lambda command: f"output:{command}"

        def handle(value):
            request = {
                **value,
                "_event": threading.Event(),
                "_cancelled": threading.Event(),
            }
            reply = {}
            bridge._RequestDispatcher._handle(dispatcher, request, reply)
            self.assertTrue(request["_event"].is_set())
            return reply

        request_a = "4b18ce4d-bf31-456e-ae31-e8c547b2f9db"
        request_b = "8ca93d11-107d-41ed-8b40-31dd53cd26a6"
        for request_id, command in ((request_a, "A"), (request_b, "B")):
            result = handle({
                "kind": "command",
                "request_id": request_id,
                "expected_generation": 4,
                "command": command,
            })
            self.assertTrue(result["ok"])

        status = handle({"kind": "status"})
        self.assertEqual(
            {receipt["request_id"] for receipt in status["completed_commands"]},
            {request_a, request_b},
        )
        acknowledged = handle({"kind": "ack", "request_id": request_a})
        self.assertTrue(acknowledged["acknowledged"])
        after_ack = handle({"kind": "status"})
        self.assertEqual(
            [receipt["request_id"] for receipt in after_ack["completed_commands"]],
            [request_b],
        )

    def test_stale_generation_rejections_are_terminal_and_acknowledged(self):
        dispatcher = object.__new__(bridge._RequestDispatcher)
        dispatcher.generation = 4
        dispatcher.current_file = "/tmp/sample.bin"
        dispatcher.cutter_version = "test"
        dispatcher.completed_commands = {}
        dispatcher._receipt_lock = threading.Lock()
        dispatcher._refresh_document_identity = lambda: None

        def handle(value):
            request = {
                **value,
                "_event": threading.Event(),
                "_cancelled": threading.Event(),
            }
            reply = {}
            bridge._RequestDispatcher._handle(dispatcher, request, reply)
            self.assertTrue(request["_event"].is_set())
            return reply

        invalid_id = str(uuid.UUID(int=bridge.MAX_COMPLETION_RECEIPTS + 10))
        invalid = handle({
            "kind": "command",
            "request_id": invalid_id,
            "expected_generation": 4,
            "command": "",
        })
        self.assertEqual(invalid["execution_state"], "not_started")
        self.assertTrue(handle({"kind": "ack", "request_id": invalid_id})["acknowledged"])

        for index in range(bridge.MAX_COMPLETION_RECEIPTS + 1):
            request_id = str(uuid.UUID(int=index + 1))
            response = handle({
                "kind": "command",
                "request_id": request_id,
                "expected_generation": 3,
                "command": "iI",
            })
            self.assertEqual(response["execution_state"], "not_started")
            self.assertEqual(response["error"], "active-document-generation-changed")
            self.assertTrue(handle({"kind": "ack", "request_id": request_id})["acknowledged"])

        self.assertEqual(dispatcher.completed_commands, {})
        self.assertTrue(dispatcher.can_accept_command())

    def test_poisoned_rejection_is_definitively_not_started_without_dispatch(self):
        self.server.poisoned = True
        response, _ = self.exchange({
            "kind": "command",
            "session_id": self.server.session_id,
            "request_id": "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
        })
        self.assertEqual(response["error"], "session-poisoned-after-ui-timeout")
        self.assertEqual(response["execution_state"], "not_started")
        self.assertEqual(self.dispatcher.commands, [])

    def test_receipt_capacity_rejects_before_ui_dispatch(self):
        self.dispatcher.can_accept_command = lambda: False
        response, _ = self.exchange({
            "kind": "command",
            "session_id": self.server.session_id,
            "request_id": "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
        })
        self.assertEqual(response["error"], "completion-receipt-capacity-exceeded")
        self.assertEqual(response["execution_state"], "not_started")
        self.assertEqual(self.dispatcher.commands, [])

    def test_status_probe_recovers_only_after_timed_out_ui_operation_finishes(self):
        timed_out, _ = self.exchange({"kind": "command", "session_id": self.server.session_id})
        self.assertEqual(timed_out["error"], "ui-thread-request-timeout")
        self.assertTrue(self.server.poisoned)
        self.assertTrue(self.dispatcher.command_started.wait(1))
        result = {}
        status_thread = threading.Thread(target=lambda: result.setdefault(
            "response", self.exchange({"kind": "status", "session_id": self.server.session_id})[0]
        ))
        status_thread.start()
        self.assertTrue(self.dispatcher.status_queued.wait(1))
        self.dispatcher.finish_command.set()
        status_thread.join(timeout=2)
        self.assertFalse(status_thread.is_alive())
        response = result["response"]
        self.assertTrue(response["ok"])
        self.assertEqual(response["session_id"], self.server.session_id)
        self.assertEqual(self.dispatcher.commands, ["command", "status"])

    def test_escape_expansion_uses_a_signed_truthful_truncation_fallback(self):
        sender, receiver = socket.socketpair()
        try:
            self.server._send_authenticated(sender, {
                "ok": True,
                "output": '"' * 6_000_000,
                "execution_state": "complete",
                "current_file": "/tmp/sample.bin",
                "document_generation": 4,
                "identity_status": "partial",
            }, "a" * 64, "b" * 64)
            frame_bytes = receiver.recv(bridge.MAX_FRAME_BYTES + 1)
            self.assertLessEqual(len(frame_bytes), bridge.MAX_FRAME_BYTES)
            frame = json.loads(frame_bytes)
            response = frame["response"]
            expected = hmac.new(
                self.server.token.encode(),
                f"rea-cutter-response-v2:{self.server.session_id}:{'a' * 64}:{'b' * 64}:{response}".encode(),
                hashlib.sha256,
            ).hexdigest()
            self.assertTrue(hmac.compare_digest(frame["proof"], expected))
            value = json.loads(response)
            self.assertEqual(value["ok"], True)
            self.assertEqual(value["execution_state"], "complete")
            self.assertTrue(value["output_truncated"])
            self.assertIsNone(value["output"])
        finally:
            sender.close()
            receiver.close()


class RequestFrameLimitTest(unittest.TestCase):
    def test_payload_limit_excludes_the_line_terminator(self):
        class BufferedSocket:
            def __init__(self, data):
                self.data = data

            def settimeout(self, _timeout):
                pass

            def recv(self, count):
                part, self.data = self.data[:count], self.data[count:]
                return part

        payload = b"{}" + b" " * (bridge.MAX_FRAME_BYTES - 2)
        self.assertEqual(
            bridge._BridgeServer._receive_frame(BufferedSocket(payload + b"\n")), {}
        )
        with self.assertRaisesRegex(ValueError, "frame-limit-exceeded"):
            bridge._BridgeServer._receive_frame(BufferedSocket(payload + b" " + b"\n"))

    def test_delimiter_in_a_later_chunk_is_accepted(self):
        class ShortReads:
            def __init__(self, data, size):
                self.data = data
                self.size = size

            def settimeout(self, _timeout):
                pass

            def recv(self, _count):
                part, self.data = self.data[: self.size], self.data[self.size :]
                return part

        payload = b'{"value":"' + b"A" * 70 + b'"}'
        received = bridge._BridgeServer._receive_frame(ShortReads(payload + b"\n", 3))
        self.assertEqual(received["value"], "A" * 70)
        with self.assertRaisesRegex(ValueError, "invalid framed request"):
            bridge._BridgeServer._receive_frame(ShortReads(payload + b"\n{}", 3))


def _load_cutter_bridge(suffix, raw):
    """Import a fresh plugin module under one explicit ceiling."""
    name = "rea_cutter_bridge_limit_%s" % suffix
    sys.modules.pop(name, None)
    setting = "REA_BRIDGE_MAX_REQUEST_BYTES"
    previous = os.environ.get(setting)
    if raw is None:
        os.environ.pop(setting, None)
    else:
        os.environ[setting] = raw
    try:
        spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop(setting, None)
        else:
            os.environ[setting] = previous


class _BufferedSocket:
    def __init__(self, data):
        self.data = data

    def settimeout(self, _timeout):
        pass

    def recv(self, count):
        part, self.data = self.data[:count], self.data[count:]
        return part


class BridgeRequestCeilingTest(unittest.TestCase):
    def test_unset_ceiling_matches_the_historical_16_mib_constant(self):
        module = _load_cutter_bridge("default", None)
        self.assertEqual(module.MAX_FRAME_BYTES, 16 * 1024 * 1024)
        self.assertEqual(module.BRIDGE_MAX_REQUEST_BYTES_SOURCE, "default")
        self.assertEqual(module.MINIMUM_BRIDGE_MAX_REQUEST_BYTES, 7464)
        self.assertEqual(module.MAXIMUM_BRIDGE_MAX_REQUEST_BYTES, 536870887)
        self.assertEqual(module._authenticated_frame_timeout_seconds(), 16)
        self.assertEqual(module.AUTH_FRAME_TIMEOUT_SECONDS, 1)
        payload = b"{}" + b" " * (module.MAX_FRAME_BYTES - 2)
        self.assertEqual(
            module._BridgeServer._receive_frame(_BufferedSocket(payload + b"\n")),
            {},
        )

    def test_setting_lowers_and_raises_the_frame_ceiling(self):
        lowered = _load_cutter_bridge("lowered", "8192")
        self.assertEqual(lowered.MAX_FRAME_BYTES, 8192)
        self.assertEqual(lowered.BRIDGE_MAX_REQUEST_BYTES_SOURCE, "setting")
        accepted = b"{}" + b" " * (8192 - 2)
        self.assertEqual(
            lowered._BridgeServer._receive_frame(_BufferedSocket(accepted + b"\n")),
            {},
        )
        with self.assertRaisesRegex(ValueError, "frame-limit-exceeded") as lowered_error:
            lowered._BridgeServer._receive_frame(
                _BufferedSocket(accepted + b" " + b"\n")
            )
        self.assertIn("REA_BRIDGE_MAX_REQUEST_BYTES", str(lowered_error.exception))
        raised = _load_cutter_bridge("raised", str(17 * 1024 * 1024))
        self.assertEqual(raised.MAX_FRAME_BYTES, 17 * 1024 * 1024)
        self.assertEqual(raised._authenticated_frame_timeout_seconds(), 17)
        capped = _load_cutter_bridge("capped", "536870887")
        self.assertEqual(capped._authenticated_frame_timeout_seconds(), 25)
        above_default = b"{}" + b" " * (16 * 1024 * 1024 - 1)
        self.assertGreater(len(above_default), 16 * 1024 * 1024)
        self.assertEqual(
            raised._BridgeServer._receive_frame(_BufferedSocket(above_default + b"\n")),
            {},
        )

    def test_authenticated_response_budget_excludes_the_line_terminator(self):
        module = _load_cutter_bridge("response_lf", "8192")
        server = module._BridgeServer.__new__(module._BridgeServer)
        server.token = "token"
        server.session_id = "00000000-0000-4000-8000-000000000001"

        def encode(length):
            return server._encode_authenticated_response(
                {
                    "ok": True,
                    "output": "A" * length,
                    "execution_state": "complete",
                },
                "a" * 64,
                "b" * 64,
            )

        low = 0
        high = module.MAX_FRAME_BYTES
        accepted = None
        accepted_length = None
        while low <= high:
            mid = (low + high) // 2
            encoded = encode(mid)
            if encoded is None:
                high = mid - 1
            else:
                accepted = encoded
                accepted_length = mid
                low = mid + 1
        self.assertIsNotNone(accepted)
        self.assertTrue(accepted.endswith(b"\n"))
        self.assertEqual(len(accepted) - 1, module.MAX_FRAME_BYTES)
        self.assertIsNone(encode(accepted_length + 1))

    def test_tight_status_keeps_recovery_fields_and_omits_the_path(self):
        module = _load_cutter_bridge("status_floor", "7464")
        server = module._BridgeServer.__new__(module._BridgeServer)
        server.token = "token"
        server.session_id = "00000000-0000-4000-8000-000000000001"
        receipts = [
            {
                "request_id": str(uuid.UUID(int=index + 1)),
                "execution_state": "not_started",
            }
            for index in range(module.MAX_COMPLETION_RECEIPTS)
        ]
        status = {
            "ok": True,
            "session_id": server.session_id,
            "current_file": "a" * 4095,
            "document_generation": 0,
            "cutter_version": "2.4.0",
            "identity_status": "partial",
            "completed_commands": receipts,
            "completed_connection": "f" * 16,
        }
        self.assertIsNone(
            server._encode_authenticated_response(status, "a" * 64, "b" * 64)
        )
        required = server._bounded_status_response(status)
        encoded = server._encode_authenticated_response(
            required, "a" * 64, "b" * 64
        )
        self.assertIsNotNone(encoded)
        self.assertLessEqual(len(encoded) - 1, module.MINIMUM_BRIDGE_MAX_REQUEST_BYTES)
        captured = bytearray()

        class _Capture:
            def sendall(self, data):
                captured.extend(data)

        server._send_authenticated(_Capture(), status, "a" * 64, "b" * 64)
        outer = json.loads(bytes(captured).decode("utf-8"))
        response = json.loads(outer["response"])
        self.assertEqual(response["session_id"], server.session_id)
        self.assertEqual(response["document_generation"], 0)
        self.assertEqual(response["completed_connection"], "f" * 16)
        self.assertEqual(response["completed_commands"], receipts)
        self.assertIsNone(response["current_file"])
        self.assertNotIn("cutter_version", response)
        self.assertIn("unknown", response["message"])
        self.assertIn("REA_BRIDGE_MAX_REQUEST_BYTES", response["message"])
        short = dict(status)
        short["current_file"] = "/tmp/fresh.bin"
        short["cutter_version"] = "v" * 4000
        captured.clear()
        server._send_authenticated(_Capture(), short, "a" * 64, "b" * 64)
        preserved = json.loads(
            json.loads(bytes(captured).decode("utf-8"))["response"]
        )
        self.assertEqual(preserved["current_file"], "/tmp/fresh.bin")
        self.assertEqual(preserved["document_generation"], 0)
        self.assertNotIn("cutter_version", preserved)

    def test_tight_command_keeps_completion_and_omits_the_path(self):
        module = _load_cutter_bridge("command_path", "7464")
        server = module._BridgeServer.__new__(module._BridgeServer)
        server.token = "token"
        server.session_id = "00000000-0000-4000-8000-000000000001"
        value = {
            "ok": True,
            "output": "ok",
            "execution_state": "complete",
            "current_file": "\\" * 3000,
            "document_generation": 7,
            "identity_status": "partial",
        }
        self.assertIsNone(
            server._encode_authenticated_response(value, "a" * 64, "b" * 64)
        )
        captured = bytearray()

        class _Capture:
            def sendall(self, data):
                captured.extend(data)

        server._send_authenticated(_Capture(), value, "a" * 64, "b" * 64)
        response = json.loads(json.loads(bytes(captured).decode("utf-8"))["response"])
        self.assertEqual(response["execution_state"], "complete")
        self.assertEqual(response["document_generation"], 7)
        self.assertIsNone(response["current_file"])
        self.assertIsNone(response["output"])
        self.assertTrue(response["output_truncated"])
        self.assertIn("REA_BRIDGE_MAX_REQUEST_BYTES", response["message"])
        short = dict(value)
        short["current_file"] = "/tmp/fresh.bin"
        short["output"] = "A" * 10000
        captured.clear()
        server._send_authenticated(_Capture(), short, "a" * 64, "b" * 64)
        preserved = json.loads(json.loads(bytes(captured).decode("utf-8"))["response"])
        self.assertEqual(preserved["current_file"], "/tmp/fresh.bin")
        self.assertEqual(preserved["document_generation"], 7)
        self.assertEqual(preserved["execution_state"], "complete")
        self.assertIsNone(preserved["output"])

    def test_dense_primitive_array_uses_its_encoded_size(self):
        module = _load_cutter_bridge("dense", "8192")
        zeros = [0] * 2000
        value = {"ok": True, "output": zeros, "execution_state": "complete"}
        self.assertTrue(module._within_response_limit(value))
        server = module._BridgeServer.__new__(module._BridgeServer)
        server.token = "token"
        server.session_id = "00000000-0000-4000-8000-000000000001"
        encoded = server._encode_authenticated_response(value, "a" * 64, "b" * 64)
        self.assertIsNotNone(encoded)
        response = json.loads(json.loads(encoded)["response"])
        self.assertEqual(response["output"], zeros)
        self.assertNotIn("output_truncated", response)
        overflow = {"ok": True, "output": [0] * 8000, "execution_state": "complete"}
        self.assertFalse(module._within_response_limit(overflow))

    def test_invalid_ceilings_are_refused(self):
        for raw in ("7463", "536870888", "0", "-1", "abc", "016777216", "٨١٩٢"):
            with self.assertRaises(RuntimeError) as caught:
                _load_cutter_bridge("invalid_%s" % raw, raw)
            self.assertIn("REA_BRIDGE_MAX_REQUEST_BYTES", str(caught.exception))


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        run_serve_mode()
    else:
        unittest.main()
