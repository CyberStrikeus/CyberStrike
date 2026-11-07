import subprocess
import sys

sys.stderr.write("first")
sys.stderr.flush()
subprocess.Popen(
    [sys.executable, "-c", "import sys, time; time.sleep(0.05); sys.stderr.write('last'); sys.stderr.flush()"],
    stdout=subprocess.DEVNULL,
)
