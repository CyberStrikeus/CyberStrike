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
