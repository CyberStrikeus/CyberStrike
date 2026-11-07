#!/usr/bin/env python3
"""Demo-helper stand-in: shuts down orderly when the owner pipe closes.

Mirrors the production helper contract: the launcher owns this process group
and asks for an orderly shutdown by closing stdin (OwnerLifetime). The
production run_launch finally block then stops Hopper and Xvfb with SIGTERM;
here the fixture removes its fake X lock file instead, which is what Xvfb
does for /tmp/.X<n>-lock on a clean exit.
"""

import importlib.util
import os
import signal
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "hopper_demo_x11", Path(__file__).resolve().parents[2] / "scripts/hopper-demo-x11.py"
)
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
assert "--owner-stdin" in sys.argv

lock_dir = Path(os.environ["REA_FIXTURE_LOCK_DIR"])
lock = lock_dir / ".X199-lock"
# Xvfb writes its PID right-justified in a 10-character field.
lock.write_text(f"{os.getpid():10d}\n")

if os.environ.get("REA_FIXTURE_IGNORE_SHUTDOWN") == "1":
    while True:
        time.sleep(60)

if os.environ.get("REA_FIXTURE_SIGNAL_DEATH") == "1":
    # Die from a signal before the launcher asks for cleanup: teardown must
    # notice the signal exit instead of waiting out the orderly grace period.
    os.kill(os.getpid(), signal.SIGKILL)

owner = helper.OwnerLifetime(True)
while owner.alive():
    time.sleep(0.05)
# Orderly shutdown path: remove our own lock, like Xvfb does on SIGTERM.
lock.unlink(missing_ok=True)
(lock_dir / "orderly-shutdown").write_text("ok")
sys.exit(0)
