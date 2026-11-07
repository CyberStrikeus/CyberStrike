#!/usr/bin/env python3
import importlib.util
import json
import subprocess
import sys
import time

helper_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("hopper_demo_x11", helper_path)
if spec is None or spec.loader is None:
    raise SystemExit("unable to load helper")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

child = subprocess.Popen(
    [
        sys.executable,
        "-c",
        (
            "import signal,time;"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN);"
            "print('ready', flush=True);"
            "time.sleep(100)"
        ),
    ],
    stdout=subprocess.PIPE,
    text=True,
)
assert child.stdout is not None
if child.stdout.readline().strip() != "ready":
    raise SystemExit("child did not become ready")

started = time.monotonic()
helper.stop_process(child)
elapsed = time.monotonic() - started

print(
    json.dumps(
        {
            "returncode": child.returncode,
            "elapsed_ms": round(elapsed * 1000),
        },
        separators=(",", ":"),
    )
)

if child.returncode != -9:
    raise SystemExit(f"expected SIGKILL fallback, got {child.returncode}")
if not 1800 <= elapsed * 1000 < 4000:
    raise SystemExit(f"unexpected cleanup duration: {elapsed}")
