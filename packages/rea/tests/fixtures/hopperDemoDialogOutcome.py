#!/usr/bin/env python3
"""Exercise demo-dialog timeout parsing and the watcher itself."""

import importlib.util
import json
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "hopper_demo_x11", Path(__file__).resolve().parents[2] / "scripts/hopper-demo-x11.py"
)
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class _Stderr:
    def snapshot(self):
        return (4, "")


_failure = helper.AdapterFailure(81, "demo_dialog_absent", "missing dialog")
if _failure.with_stderr(_Stderr()) is not _failure or _failure.stderr_bytes != 4:
    raise SystemExit("AdapterFailure.with_stderr did not keep the startup failure")

DIALOG = 10
HOPPER = 11
DIALOG_TITLES = {
    DIALOG: "Registration",
    HOPPER: helper.HOPPER_WINDOW_TITLE,
}
DIALOG_TRANSIENTS = {DIALOG: HOPPER}
DIALOG_WINDOW = (DIALOG, 20, 100, 400, 280)
HOPPER_WINDOW = (HOPPER, 0, 0, 1280, 1024)


class Clock:
    def __init__(self) -> None:
        self.ms = 0

    def monotonic(self) -> float:
        return self.ms / 1000

    def sleep(self, seconds: float) -> None:
        self.ms += int(round(seconds * 1000))


class FakeX11:
    def __init__(self, titles, transients) -> None:
        self.titles = titles
        self.transients = transients

    def XFetchName(self, _display, window, target):
        value = self.titles.get(window)
        if value is None:
            return 0
        target._obj.value = value.encode("utf-8")
        return 1

    def XGetTransientForHint(self, _display, window, target):
        value = self.transients.get(window)
        if value is None:
            return 0
        target._obj.value = value
        return 1

    def XFree(self, _value):
        return 1


def timeout_outcome(configured, requested=None):
    if configured is None:
        os.environ.pop(helper.DIALOG_TIMEOUT_ENV, None)
    else:
        os.environ[helper.DIALOG_TIMEOUT_ENV] = configured
    try:
        return {"ms": helper.configured_dialog_timeout_ms(requested)}
    except helper.AdapterFailure as failure:
        return {
            "code": failure.code,
            "reason": failure.reason,
            "dialog_timeout": failure.dialog_timeout,
        }


def failure_outcome(owned, window_observed):
    failure = helper.classify_watch_timeout(owned, window_observed)
    return {"code": failure.code, "reason": failure.reason}


def watch_outcome(list_windows, timeout_ms, titles=None, transients=None):
    clock = Clock()
    try:
        dialog = helper.watch_for_demo_dialog(
            FakeX11(titles or {}, transients or {}),
            0,
            timeout_ms,
            owner_alive=lambda: True,
            socket_ready=lambda: False,
            process_owned=lambda: True,
            process_exited=lambda: False,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            list_windows=list_windows,
        )
    except helper.AdapterFailure as failure:
        return {
            "code": failure.code,
            "reason": failure.reason,
            "elapsed_ms": clock.ms,
        }
    return {"dialog": dialog[0], "elapsed_ms": clock.ms}


def late_dialog(timeout_ms, legacy_limit_ms):
    clock = Clock()
    arrival_ms = legacy_limit_ms + 100

    def list_windows():
        if clock.ms < arrival_ms:
            return []
        return [DIALOG_WINDOW]

    try:
        dialog = helper.watch_for_demo_dialog(
            FakeX11(DIALOG_TITLES, DIALOG_TRANSIENTS),
            0,
            timeout_ms,
            owner_alive=lambda: True,
            socket_ready=lambda: False,
            process_owned=lambda: True,
            process_exited=lambda: False,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            list_windows=list_windows,
        )
    except helper.AdapterFailure as failure:
        return {
            "code": failure.code,
            "reason": failure.reason,
            "elapsed_ms": clock.ms,
            "legacy_limit_ms": legacy_limit_ms,
        }
    return {
        "dialog": dialog[0],
        "elapsed_ms": clock.ms,
        "legacy_limit_ms": legacy_limit_ms,
    }


print(
    json.dumps(
        {
            "not_owned": failure_outcome(False, False),
            "admitted_without_window": failure_outcome(True, False),
            "admitted_with_window": failure_outcome(True, True),
            "default_timeout": timeout_outcome(None),
            "configured_timeout": timeout_outcome("25000"),
            "requested_timeout": timeout_outcome("25000", 500),
            "invalid_timeout": timeout_outcome("-5"),
            "watcher_no_window": watch_outcome(lambda: [], 1_000),
            "watcher_hopper_window_without_dialog": watch_outcome(
                lambda: [HOPPER_WINDOW],
                1_000,
                {HOPPER: helper.HOPPER_WINDOW_TITLE},
            ),
            "watcher_dialog_after_legacy_limit": late_dialog(
                helper.DEFAULT_DIALOG_TIMEOUT_MS + 10_000,
                helper.DEFAULT_DIALOG_TIMEOUT_MS,
            ),
        },
        separators=(",", ":"),
    )
)
