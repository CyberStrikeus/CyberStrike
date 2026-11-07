#!/usr/bin/env python3
"""POSIX fault fixture for the optional module-reference token counter.

Use as --tokenizer-python with an explicit REA_TOKENIZER_PROBE_RECORD path.
It deliberately ignores the counter arguments, forks a detached helper that
ignores SIGTERM, and stalls. The production owned-command supervisor must
terminate the verified family. Recorded PIDs are observations, not authority
to signal a process; verification also checks the owned scope after exit.
"""

import json
import os
from pathlib import Path
import signal
import time


def main():
    record = Path(os.environ["REA_TOKENIZER_PROBE_RECORD"])
    child = os.fork()
    if child == 0:
        os.setsid()
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        record.write_text(json.dumps({
            "pid": os.getpid(),
            "group": os.getpgrp(),
            "parent": os.getppid(),
            "run_id": os.environ.get("REA_PROCESS_RUN_ID"),
            "detached": True,
            "ignores_sigterm": True,
        }) + "\n", encoding="utf-8")
    time.sleep(30)


if __name__ == "__main__":
    main()
