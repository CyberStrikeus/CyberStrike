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

export async function suidSgidScan(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SUID/SGID Binary Scan ==="]

  const script = `
echo "--- SUID Binaries ---"
find / -perm -4000 -type f 2>/dev/null | sort
echo ""
echo "--- SGID Binaries ---"
find / -perm -2000 -type f 2>/dev/null | sort
echo ""
echo "--- SUID binary details ---"
find / -perm -4000 -type f 2>/dev/null | while read -r f; do
  perms=$(ls -la "$f" 2>/dev/null | awk '{print $1, $3, $4}')
  echo "  $perms  $f"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const gtfobinsSuid = ["nmap", "vim", "vi", "find", "bash", "dash", "zsh", "sh", "python", "python3", "perl", "ruby", "env", "cp", "mv", "docker", "pkexec", "node", "php", "lua", "gcc", "make", "strace", "ltrace", "gdb", "tee", "wget", "curl", "dd", "openssl", "ssh", "scp", "mount", "systemctl", "journalctl", "apt", "yum", "pip", "pip3", "start-stop-daemon", "taskset", "nice", "ionice", "time", "timeout", "watch", "xargs", "ar", "ed", "nano", "pico", "less", "more", "man", "git", "ftp", "socat", "zip", "tar", "rsync", "awk", "gawk", "mawk", "sed"]
  const suidLines = r.stdout.split("\n").filter(l => l.startsWith("/"))
  const exploitable = suidLines.filter(l => gtfobinsSuid.some(b => l.endsWith("/" + b) || l.includes("/" + b + " ")))
  const custom = suidLines.filter(l => !l.includes("/usr/bin/") && !l.includes("/usr/sbin/") && !l.includes("/usr/lib/") && !l.includes("/bin/") && !l.includes("/sbin/"))

  if (exploitable.length > 0) {
    findings.push({
      checkId: "LNX-SUID-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "suid_binaries",
      title: "GTFOBins-exploitable SUID binaries found",
      details: `${exploitable.length} SUID binary/binaries match GTFOBins entries: ${exploitable.map(l => l.split("/").pop()).join(", ")} — can be used for privilege escalation`,
      remediation: "Remove SUID bit from unnecessary binaries (chmod u-s). Use capabilities instead where possible.",
    })
  }

  if (custom.length > 0) {
    findings.push({
      checkId: "LNX-SUID-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "suid_binaries",
      title: "Custom/non-standard SUID binaries found",
      details: `${custom.length} SUID binary/binaries in non-standard locations: ${custom.slice(0, 5).join(", ")} — may be vulnerable to exploitation`,
      remediation: "Audit custom SUID binaries for vulnerabilities. Remove SUID bit if not required.",
    })
  }

  if (suidLines.length > 0 && exploitable.length === 0) {
    findings.push({
      checkId: "LNX-SUID-003",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "suid_binaries",
      title: "SUID/SGID binaries enumerated",
      details: `${suidLines.length} SUID/SGID binary/binaries found — no direct GTFOBins matches but manual review recommended`,
      remediation: "Minimize SUID/SGID binaries on the system",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function capabilitiesAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Linux Capabilities Abuse ==="]

  const script = `
echo "--- File Capabilities ---"
getcap -r / 2>/dev/null | sort
echo ""
echo "--- Current Process Capabilities ---"
cat /proc/self/status 2>/dev/null | grep -i cap
echo ""
echo "--- Exploitable Capabilities Check ---"
getcap -r / 2>/dev/null | grep -iE "(cap_setuid|cap_setgid|cap_dac_override|cap_dac_read_search|cap_sys_admin|cap_sys_ptrace|cap_sys_module|cap_net_raw|cap_net_bind_service|cap_net_admin|cap_fowner|cap_chown|cap_mknod)" 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const capMap: Record<string, { severity: string; desc: string }> = {
    cap_setuid: { severity: "HIGH", desc: "can change UID — direct root escalation via setuid(0)" },
    cap_setgid: { severity: "HIGH", desc: "can change GID — escalate to privileged groups" },
    cap_dac_override: { severity: "HIGH", desc: "bypasses file permission checks — read/write any file" },
    cap_dac_read_search: { severity: "HIGH", desc: "bypasses read permission checks — read any file including /etc/shadow" },
    cap_sys_admin: { severity: "HIGH", desc: "mount namespace escape, BPF, many kernel operations" },
    cap_sys_ptrace: { severity: "HIGH", desc: "process injection via ptrace — inject into root processes" },
    cap_sys_module: { severity: "HIGH", desc: "load kernel modules — rootkit insertion" },
    cap_net_raw: { severity: "MEDIUM", desc: "raw sockets — packet sniffing and spoofing" },
    cap_net_admin: { severity: "MEDIUM", desc: "network configuration — route manipulation, firewall changes" },
    cap_fowner: { severity: "HIGH", desc: "bypass ownership checks — chown any file" },
    cap_chown: { severity: "HIGH", desc: "change file ownership — take ownership of /etc/shadow" },
  }

  const capLines = r.stdout.split("\n").filter(l => l.includes("cap_"))
  for (const line of capLines) {
    for (const [cap, info] of Object.entries(capMap)) {
      if (line.toLowerCase().includes(cap)) {
        const binary = line.split(" ")[0] || "unknown"
        findings.push({
          checkId: `LNX-CAP-${cap.replace("cap_", "").toUpperCase().slice(0, 6)}`,
          provider: "linuxhook",
          severity: info.severity,
          status: "VULNERABLE",
          resource: binary,
          title: `Exploitable capability: ${cap} on ${binary.split("/").pop()}`,
          details: `${binary} has ${cap} — ${info.desc}`,
          remediation: `Remove capability: setcap -r ${binary}. Use minimal capabilities instead of broad grants.`,
        })
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      checkId: "LNX-CAP-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "NOT_FOUND",
      resource: "capabilities",
      title: "No exploitable file capabilities found",
      details: "No files with dangerous capabilities detected",
      remediation: "Continue with other privilege escalation vectors",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cronPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Cron Privilege Escalation ==="]

  const script = `
echo "--- System Crontab ---"
cat /etc/crontab 2>/dev/null
echo ""
echo "--- /etc/cron.d/ ---"
for f in /etc/cron.d/*; do
  [ -f "$f" ] && echo "==> $f <==" && cat "$f" 2>/dev/null | grep -vE "^#|^$"
done
echo ""
echo "--- /etc/cron.{hourly,daily,weekly,monthly} ---"
for d in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
  [ -d "$d" ] && echo "==> $d <==" && ls -la "$d/" 2>/dev/null
done
echo ""
echo "--- User crontabs ---"
ls -la /var/spool/cron/crontabs/ 2>/dev/null || ls -la /var/spool/cron/ 2>/dev/null
crontab -l 2>/dev/null && echo "[+] Current user crontab above"
echo ""
echo "--- Writable cron scripts ---"
for f in /etc/cron.d/* /etc/cron.hourly/* /etc/cron.daily/* /etc/cron.weekly/* /etc/cron.monthly/*; do
  [ -f "$f" ] && [ -w "$f" ] && echo "[!] WRITABLE: $f"
done
echo ""
echo "--- Writable cron command targets ---"
cat /etc/crontab /etc/cron.d/* 2>/dev/null | grep -vE "^#|^$" | awk '{for(i=6;i<=NF;i++) printf "%s ", $i; print ""}' | while read -r cmd; do
  first=$(echo "$cmd" | awk '{print $1}')
  [ -f "$first" ] && [ -w "$first" ] && echo "[!] WRITABLE TARGET: $first (from cron)"
done
echo ""
echo "--- Wildcard in cron commands ---"
grep -rn '\\*' /etc/crontab /etc/cron.d/* 2>/dev/null | grep -E "(tar |rsync |chown |chmod |cp )" | grep -v "^#"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE:")) {
    const writable = r.stdout.split("\n").filter(l => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-CRON-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "cron",
      title: "Writable cron scripts found",
      details: `${writable.length} writable cron script(s): ${writable[0]?.replace("[!] WRITABLE: ", "")} — inject commands for root execution`,
      remediation: "Set cron scripts to root:root 755 or more restrictive. Audit cron script permissions regularly.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE TARGET:")) {
    const targets = r.stdout.split("\n").filter(l => l.includes("[!] WRITABLE TARGET:"))
    findings.push({
      checkId: "LNX-CRON-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "cron",
      title: "Writable cron command targets",
      details: `${targets.length} writable binary/script executed by cron: ${targets[0]?.replace("[!] WRITABLE TARGET: ", "")}`,
      remediation: "Ensure all binaries executed by cron are owned by root and not writable by others.",
    })
  }

  if (r.stdout.match(/(tar |rsync |chown |chmod ).*\*/)) {
    findings.push({
      checkId: "LNX-CRON-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "cron",
      title: "Wildcard injection possible in cron",
      details: "Cron job uses tar/rsync/chown/chmod with wildcard (*) — create specially named files for argument injection (e.g., --checkpoint-action for tar)",
      remediation: "Avoid wildcards in cron commands. Use full paths and explicit file lists.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function nfsNoRootSquash(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== NFS no_root_squash Check ==="]

  const script = `
echo "--- /etc/exports ---"
cat /etc/exports 2>/dev/null || echo "/etc/exports not found or not readable"
echo ""
echo "--- Mounted NFS Shares ---"
mount | grep nfs 2>/dev/null
df -T 2>/dev/null | grep nfs
echo ""
echo "--- showmount (local) ---"
showmount -e 127.0.0.1 2>/dev/null || showmount -e localhost 2>/dev/null || echo "showmount not available"
echo ""
echo "--- no_root_squash check ---"
grep -i "no_root_squash" /etc/exports 2>/dev/null
echo ""
echo "--- NFS-related services ---"
systemctl status nfs-server nfs-kernel-server rpcbind 2>/dev/null | grep -E "(Active:|Loaded:)" || service nfs-kernel-server status 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("no_root_squash")) {
    const shares = r.stdout.split("\n").filter(l => l.includes("no_root_squash"))
    findings.push({
      checkId: "LNX-NFS-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "nfs",
      title: "NFS share with no_root_squash",
      details: `${shares.length} NFS share(s) exported with no_root_squash: ${shares[0]?.trim()} — mount remotely, create SUID binary, escalate to root`,
      remediation: "Use root_squash (default) on all NFS exports. Restrict NFS exports to specific hosts.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pathHijack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== PATH Hijack Check ==="]

  const script = `
echo "--- Current PATH ---"
echo "$PATH"
echo ""
echo "--- Writable directories in PATH ---"
IFS=: read -ra dirs <<< "$PATH" 2>/dev/null || dirs=$(echo "$PATH" | tr ':' ' ')
for d in $dirs; do
  [ -d "$d" ] && [ -w "$d" ] && echo "[!] WRITABLE: $d"
done
echo ""
echo "--- Root scripts with relative paths ---"
grep -rlE "^[^/].*[a-z]" /etc/init.d/ 2>/dev/null | head -10
echo ""
echo "--- Systemd units with relative ExecStart ---"
grep -rn "ExecStart=" /etc/systemd/system/ /usr/lib/systemd/system/ 2>/dev/null | grep -v "ExecStart=/" | grep -v "^#" | head -10
echo ""
echo "--- Cron jobs with relative commands ---"
cat /etc/crontab /etc/cron.d/* 2>/dev/null | grep -vE "^#|^$|^[A-Z]" | awk '{for(i=6;i<=NF;i++) printf "%s ", $i; print ""}' | grep -v "^/" | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE:")) {
    const writable = r.stdout.split("\n").filter(l => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-PATH-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "PATH",
      title: "Writable directories in PATH",
      details: `${writable.length} writable directory/directories in PATH: ${writable.map(l => l.replace("[!] WRITABLE: ", "")).join(", ")} — place malicious binary to hijack commands`,
      remediation: "Remove writable directories from PATH. Ensure PATH directories are owned by root with restricted permissions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ldPreloadAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== LD_PRELOAD / Shared Library Abuse ==="]

  const script = `
echo "--- sudo env_keep check ---"
sudo -l 2>/dev/null | grep -iE "LD_PRELOAD|LD_LIBRARY_PATH|LIBPATH"
echo ""
echo "--- /etc/ld.so.preload ---"
ls -la /etc/ld.so.preload 2>/dev/null
cat /etc/ld.so.preload 2>/dev/null
[ -w /etc/ld.so.preload ] 2>/dev/null && echo "[!] /etc/ld.so.preload is WRITABLE"
[ ! -f /etc/ld.so.preload ] && [ -w /etc/ ] && echo "[!] /etc/ld.so.preload does not exist but /etc/ is writable"
echo ""
echo "--- LD_LIBRARY_PATH in environment ---"
env 2>/dev/null | grep -i "LD_"
echo ""
echo "--- RPATH/RUNPATH in SUID binaries ---"
find / -perm -4000 -type f 2>/dev/null | head -20 | while read -r f; do
  rpath=$(readelf -d "$f" 2>/dev/null | grep -iE "RPATH|RUNPATH")
  [ -n "$rpath" ] && echo "[!] $f: $rpath"
done
echo ""
echo "--- Writable library paths ---"
cat /etc/ld.so.conf /etc/ld.so.conf.d/* 2>/dev/null | grep -v "^#" | while read -r libdir; do
  [ -d "$libdir" ] && [ -w "$libdir" ] && echo "[!] WRITABLE LIB DIR: $libdir"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.match(/env_keep.*LD_PRELOAD/i) || r.stdout.match(/env_keep.*LD_LIBRARY_PATH/i)) {
    findings.push({
      checkId: "LNX-LDPRELOAD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudo",
      title: "LD_PRELOAD preserved through sudo",
      details: "sudo env_keep includes LD_PRELOAD or LD_LIBRARY_PATH — compile malicious .so, run sudo with LD_PRELOAD=./evil.so to get root shell",
      remediation: "Remove LD_PRELOAD and LD_LIBRARY_PATH from sudo env_keep.",
    })
  }

  if (r.stdout.includes("[!] /etc/ld.so.preload is WRITABLE")) {
    findings.push({
      checkId: "LNX-LDPRELOAD-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "/etc/ld.so.preload",
      title: "/etc/ld.so.preload is writable",
      details: "/etc/ld.so.preload is writable — add malicious .so path to inject into every dynamically linked process on the system",
      remediation: "Set /etc/ld.so.preload to root:root 644. Monitor changes with file integrity tools.",
    })
  }

  if (r.stdout.includes("RPATH") || r.stdout.includes("RUNPATH")) {
    findings.push({
      checkId: "LNX-LDPRELOAD-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "suid_rpath",
      title: "SUID binary with RPATH/RUNPATH",
      details: "SUID binary has custom RPATH/RUNPATH — if the path is writable, place malicious .so for privilege escalation",
      remediation: "Rebuild SUID binaries without RPATH. Use system library paths only.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE LIB DIR:")) {
    findings.push({
      checkId: "LNX-LDPRELOAD-004",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "ld.so.conf",
      title: "Writable library directory in ld.so.conf",
      details: "A library directory from ld.so.conf is writable — place malicious .so to be loaded by privileged processes",
      remediation: "Restrict library directory permissions. Ensure ld.so.conf directories are root-owned.",
    })
  }

  return { output: output.join("\n"), findings }
}
