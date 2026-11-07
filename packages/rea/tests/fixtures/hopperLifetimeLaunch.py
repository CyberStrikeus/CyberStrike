#!/usr/bin/env python3
"""Inspect the real Node launcher stdio with the production lifetime parser."""

import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location(
    "hopper_demo_x11", Path(__file__).resolve().parents[2] / "scripts/hopper-demo-x11.py"
)
assert spec is not None and spec.loader is not None
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
assert "--owner-stdin" in sys.argv
print(json.dumps({"owner_alive": helper.OwnerLifetime(True).alive()}))
