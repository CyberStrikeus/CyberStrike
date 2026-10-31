#!/usr/bin/env python3

import subprocess
import sys
import time
from pathlib import Path


fixture = str(Path(__file__).resolve())
subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)", fixture],
)
while True:
    time.sleep(60)
