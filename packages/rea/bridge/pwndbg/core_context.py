"""Fixed core-only GDB/pwndbg operation; no caller commands or historical PID lookup."""
import json
import os
from pathlib import Path
import resource
import gdb

OUTPUT_BYTES = 64 * 1024 * 1024


class ContextFailure(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def inspect(request):
    if gdb.selected_inferior().connection is not None:
        raise ContextFailure("decoder", "Owned GDB unexpectedly has an inferior connection before core loading.")
    root = Path(os.environ["REA_CORE_CONTEXT_REQUEST"]).parent
    empty = root / "no-libraries"
    empty.mkdir(mode=0o700)
    for command in ["set auto-load off", "set debuginfod enabled off", "set auto-solib-add off", "set history save off", "set pagination off", "set target-file-system-kind unix",
                    "set sysroot ./no-libraries", "set solib-search-path ./no-libraries",
                    "set debug-file-directory ./no-libraries"]:
        gdb.execute(command, to_string=True)
    entry = request["gdbinit"]
    try:
        exec(compile(Path(entry).read_bytes(), entry, "exec"), {"__name__": "__main__", "__file__": entry})
        import pwndbg.aglib.vmmap
        import pwndbg.lib.version
    except (ImportError, OSError) as error:
        raise ContextFailure("unavailable", "Selected pwndbg could not initialize: " + str(error)) from error
    version = pwndbg.lib.version.__version__
    if version != "2026.09.15" and not version.startswith("2026.09.15 build: "):
        raise ContextFailure("unsupported", "Expected unchanged pwndbg2026.09.15; selected plugin reports " + version + ".")
    gdb.execute('set context-sections ""', to_string=True)
    # core-file takes a raw filename and retains quote characters. Use a fixed
    # relative filename in the owned cwd so no selected path becomes GDB syntax.
    if Path(request["snapshot_path"]) != root.parent / "object.snapshot":
        raise ContextFailure("decoder", "Core context request did not select the shared owned snapshot.")
    # GDB 16 searches AT_EXECFN/NT_FILE outside sysroot when no executable BFD
    # is selected. Occupy that slot with the already running, owned debugger;
    # exec-file loads no symbols and never runs it. Clear it before any query.
    # /proc/self/exe identifies this process, not the core's historical PID.
    architecture = {"x86_64-little-endian": "i386:x86-64", "aarch64-little-endian": "aarch64"}.get(request["architecture"])
    if architecture is None:
        raise ContextFailure("unsupported", "Unsupported recorded core architecture.")
    gdb.execute("exec-file /proc/self/exe", to_string=True)
    # The placeholder must not select the core's architecture. Reuse the
    # decoder's validated profile, including for cross-architecture GDB builds.
    gdb.execute("set architecture " + architecture, to_string=True)
    gdb.execute("core-file ../object.snapshot", to_string=True)
    gdb.execute("file", to_string=True)
    inferior = gdb.selected_inferior()
    if inferior.connection is None or inferior.connection.type != "core" or gdb.current_progspace().filename is not None:
        raise ContextFailure("decoder", "Requested core-only boundary was not established; no mapping query performed.")
    maps = []
    for page in pwndbg.aglib.vmmap.get():
        flags = page.flags
        maps.append({"start": hex(page.start), "end": hex(page.end), "offset": hex(page.offset), "reported_flags": flags,
                     "permissions": {"read": bool(flags & 4), "write": bool(flags & 2), "execute": bool(flags & 1)} if 1 <= flags <= 7 else None,
                     "pathname_display": page.objfile, "current_file_identity": "unknown"})
    return {"status": "available", "gdb_version": gdb.VERSION, "pwndbg_version": version, "connection": "core", "executable": None,
            "historical_pid": inferior.pid, "reported_limits": {"address_space_bytes": resource.getrlimit(resource.RLIMIT_AS)[0], "cpu_seconds": resource.getrlimit(resource.RLIMIT_CPU)[0], "file_size_bytes": resource.getrlimit(resource.RLIMIT_FSIZE)[0]}, "maps": maps, "confidence": "derived", "completeness": "unknown",
            "diagnostics": {"stdout": "", "stderr": "", "truncated": False}}


def failure_exit(request_path, status, marker):
    try:
        descriptor = os.open(Path(request_path).parent / "resource.failure", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(descriptor, marker)
        os.close(descriptor)
    except (OSError, MemoryError):
        pass
    os._exit(status)


def main():
    request_path = os.environ["REA_CORE_CONTEXT_REQUEST"]
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    reserve = bytearray(1024 * 1024)
    try:
        reply = {"ok": True, "value": inspect(request)}
    except ContextFailure as error:
        reply = {"ok": False, "reason": error.reason, "message": str(error)}
    except MemoryError:
        reserve = None
        failure_exit(request_path, 75, b"M")
    except Exception as error:
        if isinstance(error, OSError) and error.errno == 12:
            reserve = None
            failure_exit(request_path, 75, b"M")
        reply = {"ok": False, "reason": "decoder", "message": type(error).__name__ + ": " + str(error)}
    try:
        encoded = json.dumps(reply, ensure_ascii=True, allow_nan=False).encode("utf-8")
        if len(encoded) > OUTPUT_BYTES:
            encoded = json.dumps({"ok": False, "reason": "output-limit", "message": "Complete debugger context exceeds the 64 MiB reply budget."}).encode("utf-8")
        descriptor = os.open(request["reply_path"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
    except MemoryError:
        reserve = None
        failure_exit(request_path, 75, b"M")
    except OSError as error:
        if error.errno == 27:
            failure_exit(request_path, 76, b"F")
        if error.errno == 12:
            reserve = None
            failure_exit(request_path, 75, b"M")
        raise


main()
