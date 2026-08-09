import { bash, sh, python3, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function sudoMisconfig(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Sudo Misconfiguration Check ==="]

  const script = `
echo "--- sudo -l (current user) ---"
sudo -l 2>/dev/null || echo "sudo -l failed (may need password)"
echo ""
echo "--- /etc/sudoers (if readable) ---"
cat /etc/sudoers 2>/dev/null | grep -vE "^#|^$" || echo "Cannot read /etc/sudoers"
echo ""
echo "--- /etc/sudoers.d/ ---"
ls -la /etc/sudoers.d/ 2>/dev/null
for f in /etc/sudoers.d/*; do
  [ -f "$f" ] && echo "==> $f <==" && cat "$f" 2>/dev/null | grep -vE "^#|^$"
done
echo ""
echo "--- NOPASSWD entries ---"
grep -rE "NOPASSWD" /etc/sudoers /etc/sudoers.d/ 2>/dev/null
echo ""
echo "--- env_keep entries ---"
grep -rE "env_keep" /etc/sudoers /etc/sudoers.d/ 2>/dev/null
echo ""
echo "--- GTFOBins-matchable sudo entries ---"
sudo -l 2>/dev/null | grep -iE "(vim|vi|nano|find|nmap|python|perl|ruby|less|more|awk|man|ftp|socat|zip|tar|rsync|git|env|bash|sh|dash|zsh|node|php|lua|gcc|make|strace|ltrace|gdb|tee|wget|curl|cp|mv|dd|openssl|ssh|scp|mount|journalctl|systemctl|service|apt|yum|pip|docker|lxc|ansible)" 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("NOPASSWD")) {
    const nopassLines = r.stdout.split("\n").filter(l => l.includes("NOPASSWD"))
    findings.push({
      checkId: "LNX-SUDO-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudoers",
      title: "NOPASSWD sudo entries found",
      details: `${nopassLines.length} NOPASSWD entry/entries found — allows command execution as another user without password authentication: ${nopassLines[0]?.trim()}`,
      remediation: "Remove NOPASSWD from sudoers entries; require password authentication for all sudo commands",
    })
  }

  if (r.stdout.includes("(ALL : ALL) ALL") || r.stdout.includes("(ALL) ALL")) {
    findings.push({
      checkId: "LNX-SUDO-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudoers",
      title: "Unrestricted sudo access",
      details: "User has ALL:ALL sudo access — full root equivalent without restriction",
      remediation: "Restrict sudo access to specific commands; follow principle of least privilege",
    })
  }

  if (r.stdout.match(/env_keep.*LD_PRELOAD|env_keep.*LD_LIBRARY_PATH/i)) {
    findings.push({
      checkId: "LNX-SUDO-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudoers",
      title: "LD_PRELOAD/LD_LIBRARY_PATH preserved in sudo",
      details: "env_keep includes LD_PRELOAD or LD_LIBRARY_PATH — compile a malicious .so and inject via sudo to escalate",
      remediation: "Remove LD_PRELOAD and LD_LIBRARY_PATH from env_keep in sudoers",
    })
  }

  const gtfobins = ["vim", "vi", "find", "nmap", "python", "perl", "ruby", "less", "more", "awk", "man", "ftp", "socat", "zip", "tar", "rsync", "git", "env", "bash", "sh", "node", "php", "lua", "gcc", "strace", "gdb", "tee", "wget", "curl", "docker", "lxc", "ansible", "journalctl", "systemctl", "pip", "mount", "ssh"]
  const sudoOutput = r.stdout.toLowerCase()
  const matched = gtfobins.filter(b => sudoOutput.includes(b))
  if (matched.length > 0) {
    findings.push({
      checkId: "LNX-SUDO-004",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudoers",
      title: "GTFOBins-exploitable sudo entries",
      details: `Sudo allows execution of GTFOBins-listed binaries: ${matched.join(", ")} — these can be abused for shell escape or file read/write as root`,
      remediation: "Restrict sudo to binaries that cannot spawn a shell; see https://gtfobins.github.io/",
    })
  }

  if (findings.length === 0) {
    findings.push({
      checkId: "LNX-SUDO-005",
      provider: "linuxhook",
      severity: "INFO",
      status: "NOT_FOUND",
      resource: "sudoers",
      title: "No obvious sudo misconfigurations found",
      details: "Sudo configuration appears restrictive — no NOPASSWD, env_keep LD_*, or GTFOBins-matchable entries detected",
      remediation: "Continue with other privilege escalation vectors",
    })
  }

  return { output: output.join("\n"), findings }
}
