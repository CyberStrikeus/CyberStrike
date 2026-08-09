import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function shadowDump(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Shadow File Extraction ==="]

  const script = `
echo "--- Shadow File Check ---"
if [ -r /etc/shadow ]; then
  echo "[+] /etc/shadow is readable"
  echo ""
  echo "--- Hash Entries ---"
  while IFS=: read -r user hash rest; do
    if [ -n "$hash" ] && [ "$hash" != "*" ] && [ "$hash" != "!" ] && [ "$hash" != "!!" ] && [ "$hash" != "x" ]; then
      algo="unknown"
      case "$hash" in
        '$6$'*) algo="SHA-512" ;;
        '$5$'*) algo="SHA-256" ;;
        '$y$'*) algo="yescrypt" ;;
        '$2b$'*|'$2a$'*|'$2y$'*) algo="bcrypt" ;;
        '$1$'*) algo="MD5 (weak)" ;;
        '$sha1$'*) algo="SHA-1 (weak)" ;;
      esac
      echo "USER=$user  ALGO=$algo  HASH=${hash:0:20}..."
    fi
  done < /etc/shadow
else
  echo "[-] /etc/shadow is not directly readable"
  echo ""
  echo "--- Checking group readability ---"
  ls -la /etc/shadow 2>/dev/null
  stat /etc/shadow 2>/dev/null | grep -i "access\|uid\|gid"
  echo ""
  echo "--- Checking shadow group membership ---"
  id
  groups
  getent group shadow 2>/dev/null
fi

echo ""
echo "--- Passwd File (for context) ---"
grep -v "nologin\|/false\|/sync\|/halt\|/shutdown" /etc/passwd 2>/dev/null | head -30

echo ""
echo "--- Backup shadow files ---"
ls -la /etc/shadow- /etc/shadow.bak /etc/shadow.old /var/backups/shadow 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] /etc/shadow is readable")) {
    const hashCount = (r.stdout.match(/USER=/g) || []).length
    const weakAlgos = (r.stdout.match(/MD5 \(weak\)|SHA-1 \(weak\)/g) || []).length
    findings.push({
      checkId: "LNX-SHADOW-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "/etc/shadow",
      title: "Shadow file hashes extracted",
      details: `Extracted ${hashCount} password hash(es) from /etc/shadow. ${weakAlgos > 0 ? `${weakAlgos} use weak algorithms (MD5/SHA-1).` : "All use strong algorithms."}`,
      remediation: "Restrict /etc/shadow permissions to root:shadow 640. Migrate weak hashes to SHA-512 or yescrypt.",
    })
    if (weakAlgos > 0) {
      findings.push({
        checkId: "LNX-SHADOW-002",
        provider: "linuxhook",
        severity: "HIGH",
        status: "FOUND",
        resource: "/etc/shadow",
        title: "Weak password hash algorithms detected",
        details: `${weakAlgos} account(s) use MD5 or SHA-1 hashing — trivially crackable with modern GPUs`,
        remediation: "Reconfigure PAM to use SHA-512 or yescrypt (pam_unix.so sha512/yescrypt). Force password resets for affected accounts.",
      })
    }
  }

  if (r.stdout.includes("shadow.bak") || r.stdout.includes("shadow-") || r.stdout.includes("shadow.old") || r.stdout.includes("/var/backups/shadow")) {
    findings.push({
      checkId: "LNX-SHADOW-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "/etc/shadow-",
      title: "Shadow backup files found",
      details: "Backup copies of /etc/shadow exist — may have weaker permissions than the original",
      remediation: "Remove or restrict permissions on shadow backup files (shadow-, shadow.bak, /var/backups/shadow).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshKeyHarvest(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Key Harvest ==="]

  const script = `
echo "--- SSH Private Keys ---"
for dir in /root /home/*; do
  if [ -d "$dir/.ssh" ]; then
    echo "[*] Found .ssh in $dir"
    for keyfile in "$dir/.ssh/id_rsa" "$dir/.ssh/id_ecdsa" "$dir/.ssh/id_ed25519" "$dir/.ssh/id_dsa"; do
      if [ -f "$keyfile" ]; then
        perms=$(stat -c '%a' "$keyfile" 2>/dev/null || stat -f '%Lp' "$keyfile" 2>/dev/null)
        encrypted=""
        grep -q "ENCRYPTED" "$keyfile" && encrypted="(encrypted)" || encrypted="(UNENCRYPTED)"
        echo "  [+] PRIVATE KEY: $keyfile  perms=$perms $encrypted"
      fi
    done
    for pemfile in "$dir/.ssh/"*.pem "$dir/"*.pem; do
      if [ -f "$pemfile" ]; then
        perms=$(stat -c '%a' "$pemfile" 2>/dev/null || stat -f '%Lp' "$pemfile" 2>/dev/null)
        echo "  [+] PEM FILE: $pemfile  perms=$perms"
      fi
    done
    if [ -f "$dir/.ssh/authorized_keys" ]; then
      count=$(wc -l < "$dir/.ssh/authorized_keys" 2>/dev/null)
      echo "  [*] authorized_keys: $count key(s) in $dir/.ssh/authorized_keys"
    fi
    if [ -f "$dir/.ssh/known_hosts" ]; then
      count=$(wc -l < "$dir/.ssh/known_hosts" 2>/dev/null)
      echo "  [*] known_hosts: $count host(s) in $dir/.ssh/known_hosts"
    fi
    if [ -f "$dir/.ssh/config" ]; then
      echo "  [*] SSH config found: $dir/.ssh/config"
      grep -iE "^(Host |HostName |User |IdentityFile |ProxyJump |ProxyCommand )" "$dir/.ssh/config" 2>/dev/null
    fi
  fi
done

echo ""
echo "--- SSH Agent ---"
if [ -n "$SSH_AUTH_SOCK" ]; then
  echo "[+] SSH_AUTH_SOCK=$SSH_AUTH_SOCK"
  ssh-add -l 2>/dev/null && echo "[+] Agent has loaded keys" || echo "[-] Agent has no keys or not accessible"
else
  echo "[-] No SSH_AUTH_SOCK set"
  find /tmp -name "agent.*" -type s 2>/dev/null | head -5
fi

echo ""
echo "--- System SSH Keys ---"
ls -la /etc/ssh/ssh_host_*_key 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const privateKeys = (r.stdout.match(/PRIVATE KEY:/g) || []).length
  const unencrypted = (r.stdout.match(/UNENCRYPTED/g) || []).length
  if (privateKeys > 0) {
    findings.push({
      checkId: "LNX-SSH-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_keys",
      title: "SSH private keys found",
      details: `${privateKeys} SSH private key(s) found. ${unencrypted > 0 ? `${unencrypted} are UNENCRYPTED — can be used directly for lateral movement.` : "All are encrypted."}`,
      remediation: "Protect SSH private keys with strong passphrases. Rotate keys regularly. Remove unnecessary keys.",
    })
  }

  if (r.stdout.includes("SSH_AUTH_SOCK=")) {
    findings.push({
      checkId: "LNX-SSH-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_agent",
      title: "SSH agent socket accessible",
      details: "SSH agent socket is available — can be hijacked for lateral movement without needing the private key",
      remediation: "Use SSH agent forwarding sparingly. Set AddKeysToAgent to confirm or ask.",
    })
  }

  const pemFiles = (r.stdout.match(/PEM FILE:/g) || []).length
  if (pemFiles > 0) {
    findings.push({
      checkId: "LNX-SSH-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "pem_files",
      title: "PEM certificate/key files found",
      details: `${pemFiles} PEM file(s) found — may contain private keys for cloud instances or TLS`,
      remediation: "Store PEM files in a secrets manager. Restrict file permissions to 400.",
    })
  }

  return { output: output.join("\n"), findings }
}
