#!/usr/bin/env python3
import importlib.util
import json
import sys

helper_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("hopper_demo_x11", helper_path)
if spec is None or spec.loader is None:
    raise SystemExit("unable to load helper")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class FakeX11:
    def __init__(self, titles, transients):
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


x11 = FakeX11(
    {
        10: "Registration",
        11: "Hopper Disassembler",
        20: "Registration",
        21: "Unrelated application",
        30: "Other window",
    },
    {
        10: 11,
        20: 21,
    },
)

observed = [
    (20, 189, 370, 901, 284),
    (30, 0, 0, 1280, 1024),
    (10, 20, 100, 1200, 284),
]

dialog = helper.find_demo_dialog(x11, 0, observed)
if dialog is None:
    raise SystemExit("expected Hopper registration dialog was not detected")
if dialog[0] != 10:
    raise SystemExit(f"wrong dialog detected: {dialog!r}")

print(
    json.dumps(
        {
            "dialog": dialog,
            "click": helper.demo_click(dialog),
            "wrong_parent_rejected": helper.find_demo_dialog(
                x11,
                0,
                [observed[0], observed[1]],
            )
            is None,
        },
        separators=(",", ":"),
    )
)
