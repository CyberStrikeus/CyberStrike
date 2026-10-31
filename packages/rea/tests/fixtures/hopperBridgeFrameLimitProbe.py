"""Exercise the shipped bridge's request-frame bound over real socket pairs.

Four cases share one loaded bridge module:

- ``legit``: an ordinary authenticated request is served.
- ``at_limit``: a request with an exactly-limit JSON payload plus LF is served,
  so framing does not consume a payload byte.
- ``past_limit``: a peer writes one byte past the limit and never terminates the
  line. An unbounded line read cannot answer this at all, which is what makes
  Hopper allocate for as long as the peer keeps writing.
- ``stalled_line``: a peer exceeds the payload limit without a terminator,
  stops writing, and keeps the connection open. The bridge must refuse it
  without waiting for EOF, then close.
- ``eof_partial``: an authenticated, otherwise valid short JSON request has no
  LF and the peer half-closes its write side. The bridge must reject the
  incomplete frame without dispatching it, then close.
"""
import json
import os
import socket
import sys
import threading

from hopperBridgeFacadeProbe import load_bridge

READ_TIMEOUT_SECONDS = 5


def _next_response(file):
    while True:
        line = file.readline()
        if not line:
            return {"closed": True}
        value = json.loads(line.decode("utf-8"))
        if "event" not in value:
            return value


def serve(bridge, line, read_after, half_close_write=False):
    """Send one raw line and record the bridge's answer."""
    server, client = socket.socketpair()
    worker = threading.Thread(target=bridge["_serve_connection"], args=(server,))
    worker.daemon = True
    worker.start()
    file = client.makefile("rwb")
    client.settimeout(READ_TIMEOUT_SECONDS)
    outcome = {}
    dispatch_count = len(bridge["_probe_dispatches"])
    try:
        file.write(line)
        file.flush()
        if half_close_write:
            client.shutdown(socket.SHUT_WR)
        outcome["reply"] = _next_response(file)
        if read_after:
            outcome["next"] = _next_response(file)
    except OSError as error:
        outcome["reply"] = {"socket_error": type(error).__name__}
    finally:
        try:
            file.close()
        finally:
            client.close()
    worker.join(2)
    outcome["thread_released"] = not worker.is_alive()
    outcome["dispatch_calls"] = (
        len(bridge["_probe_dispatches"]) - dispatch_count
    )
    return outcome


def request_line(bridge, params):
    request = {
        "id": 1,
        "token": bridge["REA_TOKEN"],
        "method": "health",
        "params": params,
    }
    return json.dumps(request, separators=(",", ":")).encode("utf-8")


def _load(mode):
    """Resolve one ceiling. The default invocation ignores an ambient setting."""
    os.environ.pop("REA_BRIDGE_MAX_REQUEST_BYTES", None)
    injected = None
    if mode == "bytes":
        os.environ["REA_BRIDGE_MAX_REQUEST_BYTES"] = sys.argv[3]
    elif mode == "inject":
        os.environ["REA_BRIDGE_MAX_REQUEST_BYTES"] = "9000"
        injected = int(sys.argv[3])
    elif mode == "invalid":
        os.environ["REA_BRIDGE_MAX_REQUEST_BYTES"] = sys.argv[3]
        try:
            load_bridge(sys.argv[1])
        except RuntimeError as error:
            return {"error": str(error)}
        return {"error": "invalid setting was accepted"}
    elif mode != "serve":
        return {"error": "unknown probe mode"}
    return load_bridge(
        sys.argv[1],
        None if injected is None else {"REA_BRIDGE_MAX_REQUEST_BYTES": injected},
    )


def main():
    mode = sys.argv[2] if len(sys.argv) > 2 else "serve"
    bridge = _load(mode)
    if "error" in bridge and "MAX_REQUEST_BYTES" not in bridge:
        json.dump(bridge, sys.stdout)
        return
    bridge.update(REA_TOKEN="owned-token", REA_RUN_ID="owned-run")
    bridge["_probe_dispatches"] = []

    def dispatch(method, params):
        bridge["_probe_dispatches"].append((method, params))
        return {"run_id": bridge["REA_RUN_ID"], "ready": True}

    bridge["_dispatch"] = dispatch
    limit = bridge.get("MAX_REQUEST_BYTES")
    if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
        json.dump({"limit": limit}, sys.stdout)
        return

    legit = serve(bridge, request_line(bridge, {}) + b"\n", False)

    # The payload may fill the limit; the framing LF is additional.
    padding = limit - len(request_line(bridge, {"padding": ""}))
    at_limit_line = request_line(bridge, {"padding": "p" * padding}) + b"\n"
    assert len(at_limit_line) == limit + 1, len(at_limit_line)
    at_limit = serve(bridge, at_limit_line, False)

    # One byte past the limit, still unterminated and still open.
    past_limit = serve(bridge, b"x" * (limit + 1), False)

    # The payload limit plus one byte, without a terminator. The peer stays
    # connected so the bounded read must reject it without waiting for EOF.
    stalled_line = serve(bridge, b"x" * (limit + 1), True)

    # This is a valid authenticated request, but omitting LF makes it an
    # incomplete frame. EOF must terminate the read and produce a rejection;
    # the application dispatch must never see it.
    eof_partial = serve(
        bridge, request_line(bridge, {}), True, half_close_write=True
    )

    json.dump(
        {
            "limit": limit,
            "source": bridge.get("BRIDGE_MAX_REQUEST_BYTES_SOURCE"),
            "minimum": bridge.get("MINIMUM_BRIDGE_MAX_REQUEST_BYTES"),
            "maximum": bridge.get("MAXIMUM_BRIDGE_MAX_REQUEST_BYTES"),
            "legit": legit,
            "at_limit": at_limit,
            "past_limit": past_limit,
            "stalled_line": stalled_line,
            "eof_partial": eof_partial,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
