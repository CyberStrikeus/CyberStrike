#!/usr/bin/env python3
"""Observe the production xauth invocation without launching an X server."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types

spec = importlib.util.spec_from_file_location("hopper_demo_x11", sys.argv[1])
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

cookie = "0123456789abcdef" * 2
calls = []
def run(arguments, **options):
    calls.append((arguments, options))
    return types.SimpleNamespace(returncode=0)
helper.subprocess.run = run
helper.secrets.token_hex = lambda _bytes: cookie
with tempfile.TemporaryDirectory(prefix="rea-xauth-fixture-") as root:
    authority = Path(root) / "authority"
    authority.touch()
    helper.authorize_display(authority, ":123", "fixture-xauth")
    arguments, options = calls[0]
    print(json.dumps({
        "arguments": arguments,
        "stdin": options["input"].decode("ascii"),
        "cookie_in_argv": any(cookie in value for value in arguments),
        "mode": authority.stat().st_mode & 0o777,
    }))
