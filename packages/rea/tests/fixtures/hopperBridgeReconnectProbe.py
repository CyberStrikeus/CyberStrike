"""Exercise the shipped socket lifecycle with a recording native dispatch port."""
import json
from pathlib import Path
import socket
import sys
import threading
import time

from hopperBridgeFacadeProbe import load_bridge


def probe(path, socket_path, mode):
    bridge = load_bridge(path)
    bridge.update(REA_SOCKET=socket_path, REA_TOKEN="owned-token", REA_RUN_ID="owned-run",
                  REA_RECONNECT_TIMEOUT_SECONDS=0.2)
    requests = []
    entered = threading.Event()
    release = threading.Event()
    health = bridge["_dispatch"]

    def dispatch(method, params):
        requests.append(method)
        if method == "health":
            if mode == "lost-reply" and requests == ["health"]:
                entered.set()
                assert release.wait(2), "Probe never released the blocked reply"
            return health(method, params)
        assert method == "shutdown_document", method
        closed = not params.get("unconfirmed", False)
        return {"shutdown": True, "analysis_stopped": True, "document_closed": closed}

    bridge["_dispatch"] = dispatch
    failures = []

    def serve():
        try:
            bridge["_run"]()
        except Exception as error:
            failures.append(repr(error))

    worker = threading.Thread(target=serve, daemon=True)
    worker.start()
    deadline = time.monotonic() + 2
    while not Path(socket_path).exists():
        assert time.monotonic() < deadline, failures
        time.sleep(0.005)

    def connect(wait_until_listening=False):
        deadline = time.monotonic() + 2 if wait_until_listening else None
        while True:
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(2)
            try:
                client.connect(socket_path)
            except OSError as error:
                client.close()
                if (not isinstance(error, ConnectionRefusedError)
                        or deadline is None or time.monotonic() >= deadline):
                    raise
                time.sleep(0.005)
            else:
                return client, client.makefile("rwb")

    def send(file, method, token="owned-token", params=None):
        file.write((json.dumps({"id": 1, "method": method, "token": token, "params": params or {}}) + "\n").encode())
        file.flush()

    def reply(file):
        while True:
            line = file.readline()
            assert line, "Bridge closed before its reply"
            value = json.loads(line)
            if "event" not in value:
                return value

    def finish(shutdown_count):
        worker.join(2)
        assert not worker.is_alive(), "Bridge pinned its execution thread"
        assert not failures, failures
        assert not Path(socket_path).exists(), "Bridge retained its closed listener"
        assert requests.count("shutdown_document") == shutdown_count
        return {"mode": mode, "requests": requests, "listener_removed": True, "thread_released": True}

    if mode == "initial-expiry":
        return finish(0)

    # bind() creates the socket path before listen() makes it connectable.
    client, file = connect(wait_until_listening=True)
    if mode == "silent-expiry":
        result = finish(0)
        file.close()
        client.close()
        return result
    send(file, "health", "foreign-token" if mode == "unauthorized" else "owned-token")
    if mode == "lost-reply":
        assert entered.wait(2)
    elif mode == "unauthorized":
        assert reply(file)["error"]["type"] == "authorization"
    else:
        assert reply(file)["result"]["run_id"] == "owned-run"
    if mode == "authenticated-idle":
        time.sleep(0.3)
        send(file, "health")
        assert reply(file)["result"]["run_id"] == "owned-run"
    file.close()
    client.close()
    release.set()
    if mode != "expiry":
        client, file = connect()
        send(file, "health")
        assert reply(file)["result"]["run_id"] == "owned-run"
        send(file, "shutdown_document", params={"unconfirmed": True})
        assert reply(file)["result"]["document_closed"] is False
        send(file, "shutdown_document")
        assert reply(file)["result"]["document_closed"] is True
        file.close()
        client.close()
    return finish(0 if mode == "expiry" else 2)


if __name__ == "__main__":
    print(json.dumps([probe(sys.argv[1], str(Path(sys.argv[2]) / (mode + ".sock")), mode)
                      for mode in ("unauthorized", "disconnect", "lost-reply", "authenticated-idle", "expiry", "initial-expiry", "silent-expiry")]))
