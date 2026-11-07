"""Lower inherited limits before replacing this owned process with GDB."""
import json
import os
from pathlib import Path
import sys

runtime_path = Path(__file__).parent.parent / "pwntools" / "decoder_runtime.py"
runtime = {"__file__": str(runtime_path), "__name__": "rea_decoder_runtime"}
exec(compile(runtime_path.read_bytes(), str(runtime_path), "exec"), runtime)


class LaunchFailure(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def launch(snapshot, cache):
    request_path = sys.argv[-1]
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    bridge = str(Path(__file__).with_name("core_context.py"))
    environment = dict(os.environ, REA_CORE_CONTEXT_REQUEST=request_path)
    # Only fixed package code appears in the GDB Python command. Selected paths stay JSON data.
    command = "python exec(compile(open(" + repr(bridge) + ", 'rb').read(), " + repr(bridge) + ", 'exec'), {'__name__':'__main__','__file__':" + repr(bridge) + "})"
    try:
        os.execve(request["gdb"], [request["gdb"], "-nx", "-nh", "--batch", "--quiet",
                                  "-iex", "set auto-load off", "-iex", "set debuginfod enabled off",
                                  "-iex", "set auto-solib-add off", "-ex", command], environment)
    except OSError as error:
        raise LaunchFailure("unavailable", "Selected GDB could not start (" + str(error.errno) + "): " + request["gdb"] + "; " + str(error)) from error


if __name__ == "__main__":
    runtime["main"](sys.argv[-1], launch, LaunchFailure, "pwndbg-core-launcher")
