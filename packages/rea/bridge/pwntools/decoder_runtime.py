"""Shared bounded reply/limit protocol, independent of the supplied artifact format."""
import json
import os
from pathlib import Path
import resource
import sys

OUTPUT_BYTES = 64 * 1024 * 1024

def lower_resource_limits():
    limits = {}
    for name, kind, maximum in (
        ("address_space_bytes", resource.RLIMIT_AS, 3 * 1024**3),
        ("cpu_seconds", resource.RLIMIT_CPU, 30),
        ("file_size_bytes", resource.RLIMIT_FSIZE, OUTPUT_BYTES),
    ):
        soft, hard = resource.getrlimit(kind)
        finite = [maximum] + [value for value in (soft, hard) if value != resource.RLIM_INFINITY]
        effective = min(finite)
        # Preserve the inherited hard boundary and never raise a caller's soft limit.
        resource.setrlimit(kind, (effective, hard))
        limits[name] = effective
    return limits


def main(request_path, inspect, failure_type, profile):
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    os.environ["PWNLIB_NOTERM"] = "1"
    os.environ["PWNLIB_CACHE_DIR"] = str(Path(request_path).parent / "cache")
    limits = None
    # Release bounded emergency headroom before constructing a MemoryError reply.
    # The outer exit-status contract also covers allocation failure during serialization.
    memory_reserve = bytearray(1024 * 1024)
    try:
        limits = lower_resource_limits()
        descriptor = os.open(Path(request_path).parent / "limits.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(limits, handle)
        value = inspect(Path(request["snapshot_path"]), Path(request_path).parent / "cache")
        value["limitations"].append("Effective owned Python resource soft limits: " + json.dumps(limits, sort_keys=True) + ". Inherited tighter limits are retained.")
        reply = {"ok": True, "profile": profile, "value": value}
    except failure_type as error:
        reply = {"ok": False, "reason": error.reason, "message": str(error)}
    except MemoryError:
        memory_reserve = None
        reply = {"ok": False, "reason": "resource-limit", "message": "pwntools memory allocation failed under the effective resource limits; the exact allocation cause is unknown.", "reported_limits": limits}
    except Exception as error:
        if isinstance(error, OSError) and error.errno == 12:
            memory_reserve = None
            reply = {"ok": False, "reason": "resource-limit", "message": "pwntools reported OSError(ENOMEM); the exact allocation cause is unknown.", "reported_limits": limits}
        else:
            reply = {"ok": False, "reason": "decoder", "message": type(error).__name__ + ": " + str(error)}
    encoded = json.dumps(reply, ensure_ascii=True, allow_nan=False).encode("utf-8")
    if len(encoded) > OUTPUT_BYTES:
        encoded = json.dumps({"ok": False, "reason": "output-limit", "message": "Complete artifact result exceeds the 64 MiB reply budget."}).encode("utf-8")
    descriptor = os.open(request["reply_path"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(encoded)

