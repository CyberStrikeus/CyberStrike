"""Real loopback HTTP/3 laboratory using aioquic and caller-supplied mitmdump.

Run inside a disposable Linux guest. All native records are written by
mitmproxy's real save addon, not constructed fixtures. Endpoint stream IDs are
observations scoped to that endpoint; no MITM stream mapping is claimed.
"""

import argparse
import asyncio
import base64
import hashlib
import json
import os
import signal
import ssl
import subprocess
import time
from pathlib import Path

import aioquic
from aioquic.asyncio import QuicConnectionProtocol, connect, serve
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import DataReceived, HeadersReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ConnectionTerminated, HandshakeCompleted, StreamReset
from aioquic.quic.packet import QuicProtocolVersion


def binary(value):
    return {"base64": base64.b64encode(value).decode("ascii"), "bytes": len(value),
            "sha256": hashlib.sha256(value).hexdigest()}


def pairs(headers):
    return [[binary(name), binary(value)] for name, value in headers]


class Journal:
    def __init__(self, root):
        self.root = root
        self.events = []
        self.requests = {}
        self.responses = {}
        self.tasks = set()
        self.children = []
        self.writers = []

    def emit(self, event, **data):
        value = {"event": event, "monotonic": time.monotonic(), **data}
        self.events.append(value)
        with (self.root / "endpoints.jsonl").open("a") as handle:
            handle.write(json.dumps(value) + "\n")

    def task(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        return task



class Endpoint(QuicConnectionProtocol):
    def __init__(self, *args, journal, endpoint, **kwargs):
        super().__init__(*args, **kwargs)
        self.journal, self.endpoint = journal, endpoint
        self.http = H3Connection(self._quic)
        self.messages = {}
        self.waiters = {}
        self.concurrent = []
        self.identity = f"{endpoint}-{len(journal.events)}"

    def quic_event_received(self, event):
        if isinstance(event, HandshakeCompleted):
            # This is the negotiated runtime value in pinned aioquic 1.2.0,
            # not configuration.supported_versions or mitmproxy's QUICv1 label.
            self.journal.emit("handshake", endpoint=self.endpoint, connection=self.identity,
                              alpn=event.alpn_protocol, quic_version=int(self._quic._version))
        if isinstance(event, (StreamReset, ConnectionTerminated)):
            self.journal.emit(type(event).__name__, endpoint=self.endpoint,
                              connection=self.identity, error_code=event.error_code,
                              stream_id=getattr(event, "stream_id", None),
                              reason=getattr(event, "reason_phrase", None))
            targets = self.waiters.values() if isinstance(event, ConnectionTerminated) else [self.waiters.get(event.stream_id)]
            for waiter in targets:
                if waiter is not None and not waiter.done():
                    waiter.set_exception(ConnectionError(type(event).__name__))
        for item in self.http.handle_event(event):
            if isinstance(item, (HeadersReceived, DataReceived)):
                message = self.messages.setdefault(item.stream_id, {"headers": [], "body": bytearray()})
                if isinstance(item, HeadersReceived):
                    message["headers"].extend(item.headers)
                else:
                    message["body"].extend(item.data)
                if item.stream_ended:
                    self.completed(item.stream_id, message)

    def completed(self, stream_id, message):
        body = bytes(message["body"])
        if self.endpoint == "client":
            self.journal.emit("response-received", endpoint="client", connection=self.identity,
                              stream_id=stream_id, headers=pairs(message["headers"]), body=binary(body))
            self.waiters[stream_id].set_result(message)
            return
        headers = dict(message["headers"])
        case = headers.get(b"x-lab-case", b"curl").decode("ascii")
        self.journal.requests[case] = {"headers": pairs(message["headers"]), "body": binary(body)}
        self.journal.emit("request-received", endpoint="origin", connection=self.identity,
                          stream_id=stream_id, case=case, **self.journal.requests[case])
        if case.startswith("parallel-"):
            self.concurrent.append((case, stream_id, body))
            if len(self.concurrent) == 3:
                self.journal.task(self.answer_parallel())
        else:
            self.answer(case, stream_id, b"\x00\xfeanswer:" + case.encode() + b":" + body[::-1])

    async def answer_parallel(self):
        for case, stream_id, body in reversed(self.concurrent):
            self.answer(case, stream_id, b"\x00\xfeanswer:" + case.encode() + b":" + body[::-1])
            await asyncio.sleep(0.15)

    def answer(self, case, stream_id, body):
        headers = [(b":status", b"200"), (b"content-type", b"application/octet-stream"),
                   (b"content-length", str(len(body)).encode()),
                   (b"x-lab-case", case.encode()), (b"x-duplicate", b"one"), (b"x-duplicate", b"two")]
        self.journal.responses[case] = {"headers": pairs(headers), "body": binary(body), "finished": True}
        self.journal.emit("response-sent", endpoint="origin", connection=self.identity,
                          stream_id=stream_id, case=case, **self.journal.responses[case])
        self.http.send_headers(stream_id, headers)
        self.http.send_data(stream_id, body, end_stream=True)
        self.transmit()

    def request(self, case, body):
        stream_id = self._quic.get_next_available_stream_id()
        headers = [(b":method", b"POST"), (b":scheme", b"https"),
                   (b":authority", b"lab.test:18443"), (b":path", b"/same?token=ordinary&x=%2F"),
                   (b"x-lab-case", case.encode()), (b"content-type", b"application/octet-stream"),
                   (b"content-length", str(len(body)).encode()),
                   (b"x-duplicate", b"first"), (b"x-duplicate", b"second")]
        self.waiters[stream_id] = asyncio.get_running_loop().create_future()
        self.journal.emit("request-sent", endpoint="client", connection=self.identity,
                          stream_id=stream_id, case=case, headers=pairs(headers), body=binary(body), finished=True)
        self.http.send_headers(stream_id, headers)
        self.http.send_data(stream_id, body, end_stream=True)
        self.transmit()
        return stream_id, self.waiters[stream_id]



class Proxy:
    def __init__(self, args, root, name, http3=True):
        self.args, self.root, self.name, self.http3 = args, root, name, http3
        self.process = None
        self.log = None

    async def start(self):
        self.log = (self.root / f"{self.name}.proxy.log").open("wb")
        command = [self.args.mitmdump, "--mode", "reverse:https://lab.test:19443@127.0.0.1:18443",
                   "--set", f"confdir={self.root / 'proxy-config'}", "--set", "connection_strategy=lazy",
                   "--set", "keep_host_header=true", "--set", "store_streamed_bodies=false",
                   "--set", f"rea_lab_log={self.root / (self.name + '.producer.jsonl')}",
                   "-w", str(self.root / (self.name + '.mitm')),
                   "-s", str(Path(__file__).with_name("observe-mitmproxy-http3.py"))]
        command.extend(["--set", f"ssl_verify_upstream_trusted_ca={self.root / 'origin-ca.pem'}"])
        if not self.http3:
            command.extend(["--set", "http3=false"])
        self.process = subprocess.Popen(command, stdout=self.log, stderr=subprocess.STDOUT,
                                        start_new_session=True)
        lease = {"runId": os.environ["REA_PROCESS_RUN_ID"], "leaderPid": self.process.pid,
                 "processGroupId": self.process.pid}
        with (self.root / "process-groups.jsonl").open("a") as handle:
            handle.write(json.dumps(lease) + "\n")
        deadline = time.monotonic() + 15
        journal = self.root / f"{self.name}.producer.jsonl"
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"Proxy exited: {self.log.name}")
            if journal.exists() and '"event": "ready"' in journal.read_text():
                return self
            await asyncio.sleep(0.05)
        raise TimeoutError(f"Proxy readiness: {self.log.name}")

    async def stop(self):
        if self.process is not None and self.process.poll() is None:
            # The standalone mitmdump distribution has a bootloader parent.
            # Signal its owned session together, including the interpreter child.
            os.killpg(self.process.pid, signal.SIGINT)
            try:
                await asyncio.wait_for(asyncio.to_thread(self.process.wait), 10)
            except TimeoutError:
                os.killpg(self.process.pid, signal.SIGKILL)
                await asyncio.to_thread(self.process.wait)
                raise
        if self.process is not None:
            for _ in range(40):
                if group_is_empty(self.process.pid):
                    return
                await asyncio.sleep(0.05)
            raise RuntimeError(f"Owned proxy group still live: {self.process.pid}")

    async def close_log(self):
        if self.log is not None:
            self.log.close()


def certificates(root):
    for name in ["origin"]:
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                        "-keyout", str(root / f"{name}-key.pem"), "-out", str(root / f"{name}-ca.pem"),
                        "-days", "2", "-subj", "/CN=lab.test", "-addext", "subjectAltName=DNS:lab.test",
                        "-addext", "basicConstraints=critical,CA:TRUE"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def client_config(root):
    config = QuicConfiguration(is_client=True, alpn_protocols=["h3"], supported_versions=[QuicProtocolVersion.VERSION_1],
                               server_name="lab.test", idle_timeout=3)
    config.load_verify_locations(cafile=str(root / "proxy-config/mitmproxy-ca-cert.pem"))
    return config


def connection(root, journal):
    return connect("127.0.0.1", 18443, configuration=client_config(root),
                   create_protocol=lambda *a, **kw: Endpoint(*a, journal=journal, endpoint="client", **kw))


async def curl_request(root, journal, name, version, path="/curl", maximum=8):
    child = await asyncio.create_subprocess_exec("curl", version, "--silent", "--show-error",
                "--max-time", str(maximum), "--cacert", str(root / "proxy-config/mitmproxy-ca-cert.pem"),
                "--resolve", "lab.test:18443:127.0.0.1", "--noproxy", "*", "-H", f"x-lab-case: {name}",
                "--output", str(root / (name + ".body")), "--dump-header", str(root / (name + ".headers")),
                "--write-out", "%{json}", "https://lab.test:18443" + path,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    journal.children.append(child)
    out, err = await child.communicate()
    (root / (name + ".json")).write_bytes(out)
    (root / (name + ".stderr")).write_bytes(err)
    return child.returncode, json.loads(out)


async def tcp_origin(reader, writer, journal):
    journal.writers.append(writer)
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        case = "tcp"
        for line in head.split(b"\r\n")[1:]:
            if line.lower().startswith(b"x-lab-case:"):
                case = line.split(b":", 1)[1].strip().decode("ascii")
        body = b"\x00\xfftcp-origin"
        journal.emit("tcp-request", case=case, alpn=writer.get_extra_info("ssl_object").selected_alpn_protocol(),
                      headers=binary(head), body=binary(body))
        writer.write(b"HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ncontent-length: " +
                     str(len(body)).encode() + b"\r\nconnection: close\r\n\r\n" + body)
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


def group_is_empty(group):
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
        except FileNotFoundError:
            continue
        if fields[0] != "Z" and int(fields[2]) == group:
            return False
    return True


async def attempt_all(actions):
    failures = []
    for name, action in actions:
        try:
            await asyncio.wait_for(action(), 12)
        except BaseException as error:
            failures.append((name, error))
    return failures


async def close_resource(resource):
    resource.close()


async def finish_child(child):
    if child.returncode is None:
        child.terminate()
        try:
            await asyncio.wait_for(child.wait(), 3)
        except TimeoutError:
            child.kill()
            await child.wait()


async def finish_tasks(journal):
    for task in journal.tasks:
        if not task.done():
            task.cancel()
    results = await asyncio.gather(*journal.tasks, return_exceptions=True)
    failures = [error for error in results if isinstance(error, BaseException)
                and not isinstance(error, asyncio.CancelledError)]
    if failures:
        raise BaseExceptionGroup("Endpoint tasks failed", failures)


async def run(args):
    if aioquic.__version__ != "1.2.0":
        raise RuntimeError("This laboratory requires aioquic 1.2.0")
    root = Path(args.output).resolve()
    root.mkdir(mode=0o700)
    os.umask(0o077)
    journal = Journal(root)
    loop = asyncio.get_running_loop()
    asynchronous_errors = []
    def unexpected_exception(active_loop, context):
        asynchronous_errors.append(context.get("message", "Unexpected asynchronous error"))
        active_loop.default_exception_handler(context)
    loop.set_exception_handler(unexpected_exception)
    certificates(root)
    server = tcp_server = None
    proxies = []
    scenarios = []
    primary_error = None
    cleanup_errors = []
    try:
        config = QuicConfiguration(is_client=False, alpn_protocols=["h3"],
                                   supported_versions=[QuicProtocolVersion.VERSION_1], idle_timeout=3)
        config.load_cert_chain(str(root / "origin-ca.pem"), str(root / "origin-key.pem"))
        server = await serve("127.0.0.1", 19443, configuration=config,
                             create_protocol=lambda *a, **kw: Endpoint(*a, journal=journal, endpoint="origin", **kw))
        tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls_context.load_cert_chain(str(root / "origin-ca.pem"), str(root / "origin-key.pem"))
        tls_context.set_alpn_protocols(["http/1.1"])
        tcp_server = await asyncio.start_server(lambda r, w: journal.task(tcp_origin(r, w, journal)),
                                               "127.0.0.1", 19443, ssl=tls_context)
        proxy = Proxy(args, root, "normal")
        proxies.append(proxy)
        await proxy.start()
        async with connection(root, journal) as client:
            requests = [client.request(f"parallel-{i}", bytes([0, 255, i]) + bytes(range(256))) for i in range(3)]
            await asyncio.wait_for(asyncio.gather(*(future for _, future in requests)), 10)
        # cURL supplies an independently implemented HTTP/3 smoke case.
        code, result = await curl_request(root, journal, "curl", "--http3-only")
        if code != 0:
            raise RuntimeError("HTTP/3 cURL failed; inspect curl.stderr")
        if result["http_version"] != "3":
            raise AssertionError("cURL silently downgraded")
        await proxy.stop()
        scenarios.append({"name": "normal", "capture": "normal.mitm"})

        proxy = Proxy(args, root, "fallback", http3=False)
        proxies.append(proxy)
        await proxy.start()
        code, result = await curl_request(root, journal, "fallback", "--http3", path="/fallback")
        if code != 0 or result["http_version"] != "2":
            raise AssertionError(f"Fallback control: {result}")
        await proxy.stop()
        scenarios.append({"name": "fallback", "capture": "fallback.mitm"})

    except BaseException as error:
        primary_error = error
    finally:
        actions = []
        for proxy in proxies:
            actions.extend([(f"proxy-{proxy.name}", proxy.stop),
                            (f"proxy-log-{proxy.name}", proxy.close_log)])
        if server is not None:
            actions.append(("quic-server", lambda: close_resource(server)))
        if tcp_server is not None:
            actions.extend([("tcp-listener-close", lambda: close_resource(tcp_server)),
                            ("tcp-listener-wait", tcp_server.wait_closed)])
        for index, writer in enumerate(journal.writers):
            actions.extend([(f"tcp-writer-close-{index}", lambda w=writer: close_resource(w)),
                            (f"tcp-writer-wait-{index}", writer.wait_closed)])
        actions.append(("endpoint-tasks", lambda: finish_tasks(journal)))
        for index, child in enumerate(journal.children):
            actions.append((f"curl-child-{index}", lambda c=child: finish_child(c)))
        cleanup_errors = await attempt_all(actions)
        # This runs after every close attempt, including failed setup.
        groups = []
        async def audit_groups():
            for proxy in proxies:
                if proxy.process is not None:
                    groups.append({"group": proxy.process.pid, "empty": group_is_empty(proxy.process.pid)})
            if any(not item["empty"] for item in groups):
                raise RuntimeError("Proxy groups remain live")
        cleanup_errors.extend(await attempt_all([("process-groups", audit_groups)]))
        try:
            (root / "producer-cleanup.json").write_text(json.dumps({
                "primary_error": None if primary_error is None else str(primary_error),
                "cleanup_errors": [{"action": name, "type": type(error).__name__, "message": str(error)}
                                   for name, error in cleanup_errors], "groups": groups,
                "asynchronous_errors": asynchronous_errors}, indent=2))
        except BaseException as error:
            cleanup_errors.append(("cleanup-report", error))
    if primary_error is not None:
        for name, error in cleanup_errors:
            primary_error.add_note(f"Cleanup {name}: {error}")
        raise primary_error
    if cleanup_errors:
        raise BaseExceptionGroup("HTTP/3 producer cleanup failed", [error for _, error in cleanup_errors])
    if asynchronous_errors:
        raise RuntimeError(f"Unexpected asynchronous errors: {asynchronous_errors}")
    (root / "manifest.json").write_text(json.dumps({"profile": "http3-minimal-v1", "aioquic": aioquic.__version__,
        "scenarios": scenarios, "requests": journal.requests, "responses": journal.responses,
        "events": journal.events, "limitations": [
            "Endpoint stream IDs are scoped observations, not mitmproxy serialized IDs or mappings.",
            "The fixture reads negotiated _version from pinned aioquic 1.2.0.",
            "Only QUIC v1, Linux reverse proxy and the selected endpoints are exercised."]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mitmdump", required=True)
    parser.add_argument("--output", required=True)
    asyncio.run(run(parser.parse_args()))
