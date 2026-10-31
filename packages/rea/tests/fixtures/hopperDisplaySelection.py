#!/usr/bin/env python3
"""Exercise explicit and random display selection with simulated X11 paths."""

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import types


spec = importlib.util.spec_from_file_location("hopper_demo_x11", sys.argv[1])
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def select(requested, occupied):
    checked = []
    authorized = []
    random_calls = []

    class FakePath:
        def __init__(self, value):
            self.value = value

        def exists(self):
            checked.append(self.value)
            return self.value in occupied

    def randbelow(_bound):
        random_calls.append(_bound)
        return 23

    def authorize_display(_authority, display_name, _xauth):
        authorized.append(display_name)
        # Stop before Xvfb so the fixture only observes selection.
        raise helper.AdapterFailure(
            helper.PRIVATE_DISPLAY_UNAVAILABLE,
            "xauth_failed",
            "fixture stop",
        )

    helper.Path = FakePath
    helper.secrets = types.SimpleNamespace(randbelow=randbelow)
    helper.authorize_display = authorize_display
    try:
        helper.start_xvfb(
            Path("session"),
            argparse.Namespace(display_number=requested, xauth="xauth", xvfb="Xvfb"),
        )
        reason = None
    except helper.AdapterFailure as failure:
        reason = failure.reason
    return {
        "authorized": authorized,
        "checked": checked,
        "random_calls": len(random_calls),
        "reason": reason,
    }


print(json.dumps({
    "explicit_zero": select(0, set()),
    "explicit_zero_random_occupied": select(0, {"/tmp/.X11-unix/X123"}),
    "explicit_zero_occupied": select(0, {"/tmp/.X11-unix/X0"}),
    "explicit_one": select(1, set()),
    "omitted": select(None, set()),
}))
