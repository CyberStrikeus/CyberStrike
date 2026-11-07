"""Generate firmware bytes using standard format producers, with an independent oracle."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
source = root / "probe.c"
source.write_text("int firmware_probe(int x){return x*7+3;} int main(void){return firmware_probe(4);}\n")
subprocess.run([sys.argv[2], "-O0", "-g", "-fno-inline", str(source), "-o", str(root / "probe")], check=True)
payloads = {"etc/rea.conf": b"rea_fixture=true\n", "usr/bin/probe": (root / "probe").read_bytes()}
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
    for name, data in payloads.items():
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o644
        info.mtime = 0
        archive.addfile(info, io.BytesIO(data))
compressed = gzip.compress(buffer.getvalue(), mtime=0)
image = b"REA firmware fixture\n".ljust(64, b"\xff") + compressed + b"\x00" * 128
(root / "firmware.bin").write_bytes(image)
(root / "oracle.json").write_text(json.dumps({
    "generator": "Python tarfile USTAR + gzip; host cc; no target execution",
    "offset": 64, "length": len(compressed), "size": len(image),
    "sha256": hashlib.sha256(image).hexdigest(),
    "files": {name: {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)} for name, data in payloads.items()},
}, indent=2) + "\n")
print(root)

if len(sys.argv) > 3:
    tree = root / "ext4-root"
    tree.mkdir(exist_ok=True)
    for name, data in payloads.items():
        target = tree / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    subprocess.run([sys.argv[3], "-q", "-t", "ext4", "-F", "-d", str(tree), str(root / "ext4.bin"), "8192"], check=True)
