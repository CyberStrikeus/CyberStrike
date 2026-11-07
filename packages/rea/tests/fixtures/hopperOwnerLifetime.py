#!/usr/bin/env python3
"""Exercise the production runner with real children and a simulated X11 surface."""

import argparse
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


spec = importlib.util.spec_from_file_location("hopper_demo_x11", sys.argv[1])
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def child_command(receipt):
    return [
        sys.executable,
        "-c",
        "import os,pathlib,time;"
        f"receipt=pathlib.Path({str(receipt)!r});"
        "pending=receipt.with_suffix('.pending');"
        "pending.write_text(str(os.getpid()));pending.replace(receipt);"
        "time.sleep(100)",
    ]


if len(sys.argv) > 3:
    phase, directory = sys.argv[2], Path(sys.argv[3])

    def terminate_worker(*_):
        raise SystemExit(143)

    # Failed assertions in the parent must still unwind run_launch's finally.
    signal.signal(signal.SIGTERM, terminate_worker)

    class X11:
        def XOpenDisplay(self, *_):
            return 1

        def XDefaultRootWindow(self, *_):
            return 1

        def XDisplayWidth(self, *_):
            return 1280

        def XDisplayHeight(self, *_):
            return 1024

        def XCloseDisplay(self, *_):
            return 1

    def start_xvfb(*_):
        child = subprocess.Popen(
            child_command(directory / "xvfb.pid"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        return child, ":123", directory / "Xauthority", helper.CapturedStderr(child.stderr)

    helper.digest = lambda _: "0" * 64
    helper.start_xvfb = start_xvfb
    helper.ctypes.CDLL = lambda _: X11()
    helper.configure_x11 = lambda *_: None
    helper.windows = lambda *_: []
    socket = directory / "bridge.sock"
    if phase == "ready":
        socket.touch()
    raise SystemExit(helper.run_launch(argparse.Namespace(
        owner_stdin=True,
        hopper=sys.executable,
        expected_launcher_sha256="0" * 64,
        socket=str(socket),
        command=child_command(directory / "hopper.pid"),
    )))


with tempfile.TemporaryDirectory(prefix="rea-owner-lifetime-") as root:
    directory = Path(root)
    sentinel = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(100)"])
    worker = subprocess.Popen(
        [sys.executable, __file__, sys.argv[1], sys.argv[2], root],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 5
        receipts = [directory / "hopper.pid", directory / "xvfb.pid"]
        while not all(receipt.exists() for receipt in receipts):
            assert worker.poll() is None, worker.communicate()
            assert time.monotonic() < deadline, "owned children did not start"
            time.sleep(0.01)
        pids = [int(receipt.read_text()) for receipt in receipts]
        assert worker.poll() is None, "live owner did not retain the helper"
        assert worker.stdin is not None
        worker.stdin.close()
        assert worker.wait(timeout=5) == 0, worker.stderr.read()
        for pid in pids:
            assert not Path(f"/proc/{pid}").exists(), f"owned child {pid} survived EOF"
        assert sentinel.poll() is None, "unrelated process was stopped"
        print(json.dumps({"phase": sys.argv[2], "children_cleaned": True, "sentinel_alive": True}))
    finally:
        helper.stop_process(worker)
        helper.stop_process(sentinel)
