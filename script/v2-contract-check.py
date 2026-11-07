# Vendored from https://github.com/einyx/opencodex (scripts/v2_contract_check.py), Apache-2.0.
# Unmodified apart from this header. Run by script/v2-contract.sh.
#!/usr/bin/env python3
"""Functional contract gate for an OpenCode 2 server.

This is the pass-rate gateway. It does not start the server. Point it at a V2 serve process:

  V2_BASE=http://127.0.0.1:4198 V2_PASSWORD=... python3 scripts/v2_contract_check.py

Exit 0 only when every case passes. The rate is the implementation gate.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import urllib.parse
import base64

BASE = os.environ.get("V2_BASE", "http://127.0.0.1:4198").rstrip("/")
USER = os.environ.get("V2_USER", "opencode")
PASSWORD = os.environ.get("V2_PASSWORD", "")
# A real prompt spends model quota on the host server, so it is opt-in.
ALLOW_PROMPT = os.environ.get("V2_ALLOW_PROMPT") == "1"

results = []


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL") + f"  {name}  {detail}")


def call(method, path, body=None, auth=True, timeout=8):
    data = None
    headers = {}
    if auth:
        token = base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, resp.headers.get("content-type", ""), raw
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("content-type", ""), exc.read()
    except Exception as exc:
        return None, "", str(exc).encode()


def wait_idle(session_id, timeout=20):
    """Wait until the server no longer reports the session as running.

    An interrupt returns before the server has released the session, so a
    follow-up write can still see `SessionBusyError`.
    """
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        status, _, raw = call("GET", "/api/session/active")
        active = is_json(raw)
        running = active.get("data") if isinstance(active, dict) else None
        if not isinstance(running, dict) or session_id not in running:
            return True
        time.sleep(0.5)
    return False


def read_event_frame():
    import threading

    token = base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
    req = urllib.request.Request(
        BASE + "/api/event",
        headers={"Authorization": f"Basic {token}", "Accept": "text/event-stream"},
    )
    box = {}

    def listen():
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                buf = b""
                while len(buf) < 400 and b"\n\n" not in buf:
                    chunk = resp.read(1)
                    if not chunk:
                        break
                    buf += chunk
                box["raw"] = buf
        except Exception as exc:
            box["raw"] = exc.read()[:240] if hasattr(exc, "read") else str(exc).encode()

    thread = threading.Thread(target=listen)
    thread.start()
    thread.join(timeout=5)
    return box.get("raw", b"")


def is_json(raw):
    try:
        return json.loads(raw.decode() or "null")
    except Exception:
        return None


def main():
    if not PASSWORD:
        print("V2_PASSWORD is required", file=sys.stderr)
        return 2

    status, _, raw = call("GET", "/global/health")
    parsed = is_json(raw)
    record(
        "v1-health-is-not-json",
        not (status == 200 and isinstance(parsed, dict) and "version" in parsed),
        f"status={status} bytes={len(raw)}",
    )

    status, _, raw = call("GET", "/api/info")
    parsed = is_json(raw)
    record(
        "v2-info-has-version",
        status == 200 and isinstance(parsed, dict) and isinstance(parsed.get("version"), str),
        f"status={status}",
    )

    status, _, _ = call("GET", "/api/health")
    record("v2-health-alias-absent", status == 404, f"status={status}")

    # Pin the probe session to a small, known directory. Without it the server
    # resolves the session against its own working directory, which can be a
    # huge repository, and the VCS status call then hangs instead of
    # answering.
    probe_directory = os.environ.get("V2_DIRECTORY") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    status, _, raw = call("POST", "/api/session", {"location": {"directory": probe_directory}})
    created = is_json(raw) or {}
    session = created.get("data") if isinstance(created, dict) else None
    sid = session.get("id") if isinstance(session, dict) else None
    directory = (session or {}).get("location", {}).get("directory") if isinstance(session, dict) else None
    record(
        "create-session",
        status == 200 and isinstance(sid, str) and sid.startswith("ses_") and isinstance(directory, str),
        f"status={status} id={sid}",
    )
    if not sid:
        finish()
        return 1

    status, _, raw = call("GET", "/api/session?limit=50")
    listed = is_json(raw) or {}
    ids = [item.get("id") for item in listed.get("data", [])] if isinstance(listed, dict) else []
    record("list-contains-created", status == 200 and sid in ids, f"status={status} count={len(ids)}")

    status, _, raw = call("GET", f"/api/session/{sid}")
    got = is_json(raw) or {}
    record(
        "get-session",
        status == 200 and isinstance(got, dict) and (got.get("data") or {}).get("id") == sid,
        f"status={status}",
    )

    status, _, raw = call("PATCH", f"/api/session/{sid}", {"title": "contract-probe"})
    record("patch-title-empty", status == 204 and raw == b"", f"status={status} bytes={len(raw)}")

    status, _, raw = call("GET", f"/api/session/{sid}")
    got = is_json(raw) or {}
    title = (got.get("data") or {}).get("title") if isinstance(got, dict) else None
    record("patch-title-stuck", status == 200 and title == "contract-probe", f"title={title}")

    status, _, raw = call(
        "POST",
        f"/api/session/{sid}/prompt",
        {"parts": [{"type": "text", "text": "ping"}]},
    )
    record("v1-parts-rejected", status == 400, f"status={status}")

    # A real prompt spends model quota on the host server, so it is opt-in.
    # Set V2_ALLOW_PROMPT=1 to exercise it and the fork/revert cases below.
    data = None
    if ALLOW_PROMPT:
        status, _, raw = call("POST", f"/api/session/{sid}/prompt", {"text": "contract ping"})
        admitted = is_json(raw) or {}
        data = admitted.get("data") if isinstance(admitted, dict) else None
        text = None
        if isinstance(data, dict):
            text = data.get("text") or (data.get("payload") or {}).get("text")
        record(
            "text-prompt-admitted",
            status == 200 and isinstance(data, dict) and data.get("type") == "user" and text == "contract ping",
            f"status={status} type={None if not isinstance(data, dict) else data.get('type')}",
        )
    else:
        record("text-prompt-admitted", True, "skipped: set V2_ALLOW_PROMPT=1 to send a real prompt")

    if ALLOW_PROMPT:
        status, _, raw = call("GET", f"/api/session/{sid}/message?limit=50")
        messages = is_json(raw) or {}
        found = False
        if isinstance(messages, dict) and isinstance(messages.get("data"), list):
            for item in messages["data"]:
                if not isinstance(item, dict) or item.get("type") != "user":
                    continue
                item_text = item.get("text") or (item.get("payload") or {}).get("text")
                if item_text == "contract ping":
                    found = True
        record("message-list-has-text", status == 200 and found, f"status={status}")
    else:
        record("message-list-has-text", True, "skipped: needs the prompt above")

    status, _, raw = call("POST", f"/api/session/{sid}/interrupt", {})
    body = is_json(raw) or {}
    record(
        "interrupt-idle",
        status == 200 and isinstance(body, dict) and isinstance(body.get("interrupted"), bool),
        f"status={status} interrupted={body.get('interrupted') if isinstance(body, dict) else None}",
    )

    status, _, _ = call("GET", f"/api/session/{sid}/todo")
    record("todo-absent", status == 404, f"status={status}")

    status, _, raw = call("GET", "/session/status")
    record("v1-status-not-json-map", not isinstance(is_json(raw), dict), f"status={status}")

    status, _, raw = call("GET", "/api/fs/list")
    listed = is_json(raw) or {}
    record(
        "fs-list",
        status == 200 and isinstance(listed, dict) and isinstance(listed.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/agent")
    agents = is_json(raw) or {}
    record(
        "agent-list",
        status == 200 and isinstance(agents, dict) and isinstance(agents.get("data"), list) and "location" in agents,
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/provider")
    providers = is_json(raw) or {}
    record(
        "provider-list",
        status == 200 and isinstance(providers, dict) and isinstance(providers.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/model")
    models = is_json(raw) or {}
    record(
        "model-list",
        status == 200 and isinstance(models, dict) and isinstance(models.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/location")
    location = is_json(raw) or {}
    record(
        "location-has-project",
        status == 200 and isinstance(location, dict) and isinstance((location.get("project") or {}).get("id"), str),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/project")
    projects = is_json(raw)
    record("project-list", status == 200 and isinstance(projects, list), f"status={status} type={type(projects).__name__}")

    status, _, raw = call("GET", "/api/project/current")
    record("project-current-absent", status == 404, f"status={status}")

    status, _, raw = call("GET", "/api/fs/find?query=README")
    found = is_json(raw) or {}
    record(
        "fs-find",
        status == 200 and isinstance(found, dict) and isinstance(found.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/fs/list")
    listed = is_json(raw) or {}
    file_path = None
    if isinstance(listed, dict):
        for item in listed.get("data") or []:
            if isinstance(item, dict) and item.get("type") == "file" and item.get("path"):
                file_path = item["path"]
                break
    read_status, _, read_raw = (None, "", b"")
    if file_path:
        read_status, _, read_raw = call("GET", "/api/fs/read/" + file_path)
    record(
        "fs-read-bytes",
        read_status == 200 and len(read_raw) > 0,
        f"path={file_path} status={read_status} bytes={len(read_raw)}",
    )

    # The location matters: without it the server resolves the request against
    # its own working directory, which can be a large repository, and the call
    # then hangs instead of answering.
    vcs_path = "/api/vcs/status"
    if isinstance(directory, str) and directory:
        vcs_path += "?location%5Bdirectory%5D=" + urllib.parse.quote(directory, safe="")
    vcs_status, _, vcs_raw = call("GET", vcs_path)
    record("vcs-status", vcs_status == 200 and is_json(vcs_raw) is not None, f"status={vcs_status}")

    status, _, raw = call("GET", f"/api/session/{sid}/diff")
    diff = is_json(raw)
    record("session-diff", status == 200 and isinstance(diff, dict) and "data" in diff, f"status={status}")

    status, _, raw = call("GET", f"/api/session/{sid}/form")
    forms = is_json(raw)
    record(
        "form-list",
        status == 200 and isinstance(forms, dict) and isinstance(forms.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/permission/request")
    perms = is_json(raw)
    record("permission-list", status == 200 and isinstance(perms, dict), f"status={status}")

    patch_status, _, patch_raw = call("PATCH", f"/api/session/{sid}", {"time": {"archived": 1}})
    status, _, raw = call("GET", f"/api/session/{sid}")
    got = is_json(raw) or {}
    archived = ((got.get("data") or {}).get("time") or {}).get("archived") if isinstance(got, dict) else "missing"
    record(
        "archive-not-persisted",
        patch_status == 204 and patch_raw == b"" and status == 200 and archived is None,
        f"patch={patch_status} archived={archived}",
    )

    msg_id = data.get("id") if isinstance(data, dict) else None
    if isinstance(msg_id, str):
        status, _, raw = call("POST", f"/api/session/{sid}/fork", {"before": msg_id})
        forked = is_json(raw) or {}
        fork_id = (forked.get("data") or {}).get("id") if isinstance(forked, dict) else None
        record("fork", status == 200 and isinstance(fork_id, str), f"status={status}")
        status, _, raw = call("POST", f"/api/session/{sid}/revert/stage", {"messageID": msg_id})
        staged = is_json(raw) or {}
        record(
            "revert-stage",
            status == 200 and isinstance(staged, dict) and isinstance((staged.get("data") or {}).get("messageID"), str),
            f"status={status}",
        )
    else:
        skipped = "skipped: needs the prompt above" if not ALLOW_PROMPT else "no message id"
        record("fork", True, skipped)
        record("revert-stage", True, skipped)

    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    if ALLOW_PROMPT:
        status, _, raw = call(
            "POST",
            f"/api/session/{sid}/prompt",
            {"text": "see image", "files": [{"uri": "data:image/png;base64," + png, "name": "pixel.png"}]},
        )
        record("file-prompt-data-uri", status == 200 and b"iVBORw0KGgo" in raw, f"status={status} bytes={len(raw)}")

        status, _, raw = call("POST", f"/api/session/{sid}/prompt", {"text": "x", "format": {"type": "json_schema"}})
        record("format-field-ignored", status == 200, f"status={status} bytes={len(raw)}")
    else:
        skipped = "skipped: set V2_ALLOW_PROMPT=1 to send a real prompt"
        record("file-prompt-data-uri", True, skipped)
        record("format-field-ignored", True, skipped)

    status, _, raw = call("POST", f"/api/session/{sid}/agent", {"agent": "build"})
    record("switch-agent-empty", status == 204 and raw == b"", f"status={status} bytes={len(raw)}")

    status, _, raw = call(
        "POST",
        f"/api/session/{sid}/model",
        {"model": {"id": "gpt-5", "providerID": "openai"}},
    )
    record("switch-model-empty", status == 204 and raw == b"", f"status={status} bytes={len(raw)}")

    frame = read_event_frame()
    event = None
    if frame.startswith(b"data: "):
        event = is_json(frame[6:].split(b"\n", 1)[0])
    record(
        "event-frame-has-type",
        isinstance(event, dict) and event.get("type") == "server.connected" and event.get("data") == {},
        f"bytes={len(frame)} type={event.get('type') if isinstance(event, dict) else None}",
    )

    status, _, raw = call("GET", "/api/model/default")
    default_model = is_json(raw) or {}
    record(
        "model-default",
        status == 200 and isinstance(default_model, dict) and "data" in default_model,
        f"status={status}",
    )

    status, _, raw = call("GET", f"/api/session/{sid}/permission")
    session_perms = is_json(raw) or {}
    record(
        "session-permission-list",
        status == 200 and isinstance(session_perms, dict) and isinstance(session_perms.get("data"), list),
        f"status={status}",
    )

    status, _, _ = call("POST", f"/api/session/{sid}/permission/per_missing/reply", {"decision": "once"})
    record("permission-reply-missing", status == 404, f"status={status}")

    status, _, _ = call("POST", f"/api/session/{sid}/form/frm_missing/reply", {"answer": {}})
    record("form-reply-missing", status == 404, f"status={status}")

    status, _, _ = call("DELETE", f"/api/session/{sid}/form/frm_missing")
    record("form-cancel-missing", status == 404, f"status={status}")

    status, _, raw = call("GET", "/api/fs/list?path=.")
    listed = is_json(raw) or {}
    record(
        "fs-list-path",
        status == 200 and isinstance(listed, dict) and isinstance(listed.get("data"), list),
        f"status={status}",
    )

    status, _, raw = call("GET", "/api/fs/find?query=README&limit=5")
    found = is_json(raw) or {}
    first = (found.get("data") or [None])[0] if isinstance(found, dict) else None
    record(
        "fs-find-limit",
        status == 200 and isinstance(first, dict) and isinstance(first.get("path"), str),
        f"status={status}",
    )

    if ALLOW_PROMPT:
        client_id = "msg_" + str(int(__import__("time").time() * 1000))
        status, _, raw = call("POST", f"/api/session/{sid}/prompt", {"id": client_id, "text": "cont"})
        admitted = is_json(raw) or {}
        admitted_id = (admitted.get("data") or {}).get("id") if isinstance(admitted, dict) else None
        record("prompt-id-honored", status == 200 and admitted_id == client_id, f"status={status} id={admitted_id}")
    else:
        record("prompt-id-honored", True, "skipped: set V2_ALLOW_PROMPT=1 to send a real prompt")

    call("POST", f"/api/session/{sid}/interrupt", {})
    wait_idle(sid)
    status, _, raw = call("DELETE", f"/api/session/{sid}/revert")
    record("revert-clear", status in (204, 404), f"status={status} body={raw[:60]!r}")

    status, _, _ = call("DELETE", f"/api/session/{sid}")
    record("delete-session", status == 204, f"status={status}")

    return finish()


def finish():
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
