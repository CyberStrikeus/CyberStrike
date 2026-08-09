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
    const nopassLines = r.stdout.split("\n").filter((l) => l.includes("NOPASSWD"))
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
      details:
        "env_keep includes LD_PRELOAD or LD_LIBRARY_PATH — compile a malicious .so and inject via sudo to escalate",
      remediation: "Remove LD_PRELOAD and LD_LIBRARY_PATH from env_keep in sudoers",
    })
  }

  const gtfobins = [
    "vim",
    "vi",
    "find",
    "nmap",
    "python",
    "perl",
    "ruby",
    "less",
    "more",
    "awk",
    "man",
    "ftp",
    "socat",
    "zip",
    "tar",
    "rsync",
    "git",
    "env",
    "bash",
    "sh",
    "node",
    "php",
    "lua",
    "gcc",
    "strace",
    "gdb",
    "tee",
    "wget",
    "curl",
    "docker",
    "lxc",
    "ansible",
    "journalctl",
    "systemctl",
    "pip",
    "mount",
    "ssh",
  ]
  const sudoOutput = r.stdout.toLowerCase()
  const matched = gtfobins.filter((b) => sudoOutput.includes(b))
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
      details:
        "Sudo configuration appears restrictive — no NOPASSWD, env_keep LD_*, or GTFOBins-matchable entries detected",
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

  const gtfobinsSuid = [
    "nmap",
    "vim",
    "vi",
    "find",
    "bash",
    "dash",
    "zsh",
    "sh",
    "python",
    "python3",
    "perl",
    "ruby",
    "env",
    "cp",
    "mv",
    "docker",
    "pkexec",
    "node",
    "php",
    "lua",
    "gcc",
    "make",
    "strace",
    "ltrace",
    "gdb",
    "tee",
    "wget",
    "curl",
    "dd",
    "openssl",
    "ssh",
    "scp",
    "mount",
    "systemctl",
    "journalctl",
    "apt",
    "yum",
    "pip",
    "pip3",
    "start-stop-daemon",
    "taskset",
    "nice",
    "ionice",
    "time",
    "timeout",
    "watch",
    "xargs",
    "ar",
    "ed",
    "nano",
    "pico",
    "less",
    "more",
    "man",
    "git",
    "ftp",
    "socat",
    "zip",
    "tar",
    "rsync",
    "awk",
    "gawk",
    "mawk",
    "sed",
  ]
  const suidLines = r.stdout.split("\n").filter((l) => l.startsWith("/"))
  const exploitable = suidLines.filter((l) =>
    gtfobinsSuid.some((b) => l.endsWith("/" + b) || l.includes("/" + b + " ")),
  )
  const custom = suidLines.filter(
    (l) =>
      !l.includes("/usr/bin/") &&
      !l.includes("/usr/sbin/") &&
      !l.includes("/usr/lib/") &&
      !l.includes("/bin/") &&
      !l.includes("/sbin/"),
  )

  const versionScript = suidLines
    .slice(0, 30)
    .map((bin) => {
      const name = bin.split("/").pop() || ""
      return `VER=$("${bin}" --version 2>/dev/null | head -1) && echo "SUID_VER:${name}:${bin}:$VER"`
    })
    .join("\n")
  if (versionScript) {
    const vr = activeExec === "sh" ? await sh(versionScript, timeout) : await bash(versionScript, timeout)
    const versionLines = vr.stdout.split("\n").filter((l) => l.startsWith("SUID_VER:"))
    if (versionLines.length > 0) {
      output.push("\n--- SUID Binary Versions ---")
      const cveTargets: string[] = []
      for (const vl of versionLines) {
        const parts = vl.replace("SUID_VER:", "").split(":")
        const name = parts[0]
        const path = parts[1]
        const version = parts.slice(2).join(":").trim()
        output.push(`  ${name} (${path}): ${version}`)
        cveTargets.push(`${name} ${version}`)
      }
      output.push("")
      output.push("[!] CVE check recommended for versioned SUID binaries above.")
      output.push("    Use cve-mcp: cve search_by_product --product <name> --version <ver>")
      output.push("    If cve-mcp is not enabled: cyberstrike mcp enable cve")
    }
  }

  if (exploitable.length > 0) {
    findings.push({
      checkId: "LNX-SUID-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "suid_binaries",
      title: "GTFOBins-exploitable SUID binaries found",
      details: `${exploitable.length} SUID binary/binaries match GTFOBins entries: ${exploitable.map((l) => l.split("/").pop()).join(", ")} — can be used for privilege escalation. Check versions against CVE database via cve-mcp for version-specific exploits.`,
      remediation: "Remove SUID bit from unnecessary binaries (chmod u-s). Use capabilities instead where possible. Query: cve search_by_product --product <name> --version <ver>",
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
      details: `${custom.length} SUID binary/binaries in non-standard locations: ${custom.slice(0, 5).join(", ")} — may be vulnerable to exploitation. Check versions via cve-mcp.`,
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
      details: `${suidLines.length} SUID/SGID binary/binaries found — no direct GTFOBins matches but check versions via cve-mcp for known CVEs`,
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
    cap_dac_read_search: {
      severity: "HIGH",
      desc: "bypasses read permission checks — read any file including /etc/shadow",
    },
    cap_sys_admin: { severity: "HIGH", desc: "mount namespace escape, BPF, many kernel operations" },
    cap_sys_ptrace: { severity: "HIGH", desc: "process injection via ptrace — inject into root processes" },
    cap_sys_module: { severity: "HIGH", desc: "load kernel modules — rootkit insertion" },
    cap_net_raw: { severity: "MEDIUM", desc: "raw sockets — packet sniffing and spoofing" },
    cap_net_admin: { severity: "MEDIUM", desc: "network configuration — route manipulation, firewall changes" },
    cap_fowner: { severity: "HIGH", desc: "bypass ownership checks — chown any file" },
    cap_chown: { severity: "HIGH", desc: "change file ownership — take ownership of /etc/shadow" },
  }

  const capLines = r.stdout.split("\n").filter((l) => l.includes("cap_"))
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
    const writable = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE:"))
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
    const targets = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE TARGET:"))
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
      details:
        "Cron job uses tar/rsync/chown/chmod with wildcard (*) — create specially named files for argument injection (e.g., --checkpoint-action for tar)",
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
    const shares = r.stdout.split("\n").filter((l) => l.includes("no_root_squash"))
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
    const writable = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-PATH-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "PATH",
      title: "Writable directories in PATH",
      details: `${writable.length} writable directory/directories in PATH: ${writable.map((l) => l.replace("[!] WRITABLE: ", "")).join(", ")} — place malicious binary to hijack commands`,
      remediation:
        "Remove writable directories from PATH. Ensure PATH directories are owned by root with restricted permissions.",
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
      details:
        "sudo env_keep includes LD_PRELOAD or LD_LIBRARY_PATH — compile malicious .so, run sudo with LD_PRELOAD=./evil.so to get root shell",
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
      details:
        "/etc/ld.so.preload is writable — add malicious .so path to inject into every dynamically linked process on the system",
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
      details:
        "SUID binary has custom RPATH/RUNPATH — if the path is writable, place malicious .so for privilege escalation",
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
      details:
        "A library directory from ld.so.conf is writable — place malicious .so to be loaded by privileged processes",
      remediation: "Restrict library directory permissions. Ensure ld.so.conf directories are root-owned.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function kernelExploitCheck(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Kernel Exploit Check ==="]

  const script = `
echo "--- Kernel Version ---"
uname -r
uname -a
echo ""
echo "--- Distribution ---"
cat /etc/os-release 2>/dev/null | grep -E "^(ID|VERSION_ID|PRETTY_NAME)="
echo ""
echo "--- Kernel Build Info ---"
cat /proc/version 2>/dev/null
echo ""
echo "--- Security Modules ---"
cat /sys/kernel/security/lsm 2>/dev/null
echo ""
echo "--- KASLR Status ---"
cat /proc/sys/kernel/randomize_va_space 2>/dev/null
echo ""
echo "--- Kernel Protections ---"
cat /proc/sys/kernel/kptr_restrict 2>/dev/null && echo " (kptr_restrict)"
cat /proc/sys/kernel/dmesg_restrict 2>/dev/null && echo " (dmesg_restrict)"
cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null && echo " (perf_event_paranoid)"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const kernelLine = r.stdout.split("\n").find((l) => l.match(/^\d+\.\d+/))
  if (!kernelLine) return { output: output.join("\n"), findings }

  const parts = kernelLine.trim().split(/[.\-]/)
  const major = parseInt(parts[0]) || 0
  const minor = parseInt(parts[1]) || 0
  const patch = parseInt(parts[2]) || 0
  const ver = major * 10000 + minor * 100 + patch

  const exploits: Array<{ name: string; cve: string; min: number; max: number; note: string }> = [
    {
      name: "DirtyPipe",
      cve: "CVE-2022-0847",
      min: 50800,
      max: 51611,
      note: "Overwrite read-only files via pipe splice — instant root",
    },
    {
      name: "DirtyCow",
      cve: "CVE-2016-5195",
      min: 20622,
      max: 40803,
      note: "Race condition in COW — write to read-only mappings",
    },
    {
      name: "OverlayFS (Ubuntu)",
      cve: "CVE-2021-3493",
      min: 50400,
      max: 51100,
      note: "Ubuntu-specific overlayfs user namespace privesc",
    },
    {
      name: "GameOver(lay)",
      cve: "CVE-2023-2640",
      min: 50400,
      max: 51900,
      note: "Ubuntu overlayfs setattr bypass — unpriv user namespace",
    },
    {
      name: "Netfilter nf_tables",
      cve: "CVE-2023-32233",
      min: 50100,
      max: 60400,
      note: "Use-after-free in nf_tables — local root",
    },
    {
      name: "Netfilter nft_set_elem",
      cve: "CVE-2022-34918",
      min: 50800,
      max: 51817,
      note: "Heap buffer overflow in nft_set_elem — local root",
    },
    {
      name: "io_uring",
      cve: "CVE-2023-2598",
      min: 50100,
      max: 60300,
      note: "io_uring use-after-free — kernel code execution",
    },
    {
      name: "pipe_buffer",
      cve: "CVE-2021-22555",
      min: 20629,
      max: 51101,
      note: "Netfilter setsockopt heap OOB write — container escape capable",
    },
    {
      name: "eBPF verifier",
      cve: "CVE-2021-3490",
      min: 50700,
      max: 51300,
      note: "eBPF ALU32 bounds tracking — local root",
    },
    {
      name: "PolKit pkexec",
      cve: "CVE-2021-4034",
      min: 0,
      max: 999999,
      note: "pkexec SUID — affects all kernels if pkexec installed",
    },
  ]

  const distro = r.stdout.toLowerCase()
  const applicable = exploits.filter((e) => ver >= e.min && ver <= e.max)

  for (const exp of applicable) {
    findings.push({
      checkId: `LNX-KERNEL-${exp.cve.replace("CVE-", "").replace("-", "")}`,
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "POTENTIALLY_VULNERABLE",
      resource: `kernel ${kernelLine.trim()}`,
      title: `${exp.name} (${exp.cve})`,
      details: `Kernel ${kernelLine.trim()} falls within vulnerable range for ${exp.name} — ${exp.note}`,
      remediation: `Upgrade kernel to latest stable. Apply vendor patches for ${exp.cve}.`,
    })
  }

  if (applicable.length === 0) {
    findings.push({
      checkId: "LNX-KERNEL-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "NOT_FOUND",
      resource: `kernel ${kernelLine.trim()}`,
      title: "No known kernel exploits matched",
      details: `Kernel ${kernelLine.trim()} does not match known exploit version ranges — may still be vulnerable to newer CVEs`,
      remediation: "Keep kernel updated. Check kernel-exploits databases for latest CVEs.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function writablePasswd(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Writable /etc/passwd Check ==="]

  const script = `
echo "--- /etc/passwd permissions ---"
ls -la /etc/passwd
echo ""
echo "--- /etc/shadow permissions ---"
ls -la /etc/shadow 2>/dev/null
echo ""
echo "--- /etc/group permissions ---"
ls -la /etc/group
echo ""
echo "--- Writability check ---"
[ -w /etc/passwd ] && echo "[!] /etc/passwd is WRITABLE" || echo "[-] /etc/passwd is not writable"
[ -w /etc/shadow ] 2>/dev/null && echo "[!] /etc/shadow is WRITABLE" || echo "[-] /etc/shadow is not writable"
[ -w /etc/group ] && echo "[!] /etc/group is WRITABLE" || echo "[-] /etc/group is not writable"
echo ""
echo "--- Users with UID 0 ---"
awk -F: '$3 == 0 {print $1}' /etc/passwd 2>/dev/null
echo ""
echo "--- Users without password (empty hash field in passwd) ---"
awk -F: '($2 == "" || $2 == "x") {print $1}' /etc/passwd 2>/dev/null | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] /etc/passwd is WRITABLE")) {
    findings.push({
      checkId: "LNX-PASSWD-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "/etc/passwd",
      title: "/etc/passwd is writable",
      details:
        "/etc/passwd is writable — add a new root user: echo 'hacker:$(openssl passwd -6 password):0:0::/root:/bin/bash' >> /etc/passwd",
      remediation: "Set /etc/passwd to root:root 644. Use chattr +i for immutability.",
    })
  }

  if (r.stdout.includes("[!] /etc/shadow is WRITABLE")) {
    findings.push({
      checkId: "LNX-PASSWD-002",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "/etc/shadow",
      title: "/etc/shadow is writable",
      details: "/etc/shadow is writable — replace root password hash directly for instant root access",
      remediation: "Set /etc/shadow to root:shadow 640.",
    })
  }

  if (r.stdout.includes("[!] /etc/group is WRITABLE")) {
    findings.push({
      checkId: "LNX-PASSWD-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "/etc/group",
      title: "/etc/group is writable",
      details: "/etc/group is writable — add current user to sudo/root/docker/lxd groups",
      remediation: "Set /etc/group to root:root 644.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pkexecCve(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== PwnKit (CVE-2021-4034) Check ==="]

  const script = `
echo "--- pkexec location ---"
which pkexec 2>/dev/null || echo "pkexec not found"
echo ""
echo "--- pkexec SUID check ---"
ls -la $(which pkexec 2>/dev/null) 2>/dev/null
echo ""
echo "--- pkexec version ---"
pkexec --version 2>/dev/null || dpkg -l policykit-1 2>/dev/null | tail -1 || rpm -q polkit 2>/dev/null
echo ""
echo "--- polkit version ---"
pkaction --version 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const hasPkexec = !r.stdout.includes("pkexec not found")
  const isSuid = r.stdout.includes("-rwsr") || r.stdout.includes("rws")

  if (hasPkexec && isSuid) {
    findings.push({
      checkId: "LNX-PKEXEC-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "POTENTIALLY_VULNERABLE",
      resource: "pkexec",
      title: "pkexec SUID — PwnKit (CVE-2021-4034) potentially exploitable",
      details:
        "pkexec is installed with SUID bit — CVE-2021-4034 affects virtually all polkit versions before Jan 2022 patches. Exploit gives instant local root.",
      remediation: "Update polkit to latest version. Remove SUID from pkexec: chmod 0755 $(which pkexec).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function systemdUnitAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Systemd Unit Abuse ==="]

  const script = `
echo "--- Writable systemd unit files ---"
find /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system -writable -name "*.service" -o -writable -name "*.timer" 2>/dev/null
echo ""
echo "--- Writable ExecStart targets ---"
for unit in /etc/systemd/system/*.service /usr/lib/systemd/system/*.service /lib/systemd/system/*.service; do
  [ -f "$unit" ] || continue
  execstart=$(grep "^ExecStart=" "$unit" 2>/dev/null | head -1 | cut -d= -f2 | awk '{print $1}')
  [ -n "$execstart" ] && [ -f "$execstart" ] && [ -w "$execstart" ] && echo "[!] WRITABLE ExecStart: $execstart (from $unit)"
done
echo ""
echo "--- Timers running as root ---"
systemctl list-timers --all 2>/dev/null | head -20
echo ""
echo "--- User-writable unit directories ---"
[ -w /etc/systemd/system/ ] && echo "[!] /etc/systemd/system/ is writable"
[ -d ~/.config/systemd/user/ ] && echo "[*] User systemd dir exists: ~/.config/systemd/user/"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const writableUnits = r.stdout.split("\n").filter((l) => l.endsWith(".service") || l.endsWith(".timer"))
  if (writableUnits.length > 0) {
    findings.push({
      checkId: "LNX-SYSTEMD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "systemd",
      title: "Writable systemd unit files",
      details: `${writableUnits.length} writable unit file(s): ${writableUnits[0]} — modify ExecStart to execute payload as root`,
      remediation: "Set systemd unit files to root:root 644.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE ExecStart:")) {
    findings.push({
      checkId: "LNX-SYSTEMD-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "systemd",
      title: "Writable ExecStart binary in systemd service",
      details:
        "A binary referenced by a systemd service ExecStart is writable — replace to execute as the service user",
      remediation: "Ensure ExecStart binaries are root-owned with restricted permissions.",
    })
  }

  if (r.stdout.includes("[!] /etc/systemd/system/ is writable")) {
    findings.push({
      checkId: "LNX-SYSTEMD-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "systemd",
      title: "/etc/systemd/system/ is writable",
      details: "Can create new systemd service unit running as root — instant persistent root code execution",
      remediation: "Restrict /etc/systemd/system/ to root:root 755.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function dbusExploit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== D-Bus Service Enumeration ==="]

  const script = `
echo "--- System D-Bus services ---"
busctl list --system 2>/dev/null | head -40 || dbus-send --system --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | head -40
echo ""
echo "--- Interesting D-Bus interfaces ---"
busctl list --system 2>/dev/null | grep -iE "(polkit|PackageKit|systemd|NetworkManager|ModemManager|udisks|accounts|hostname|timedate|locale|login|realmd)" 2>/dev/null
echo ""
echo "--- PolicyKit introspection ---"
busctl introspect org.freedesktop.PolicyKit1 /org/freedesktop/PolicyKit1/Authority 2>/dev/null | head -20
echo ""
echo "--- Session D-Bus ---"
busctl list --user 2>/dev/null | head -20
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("polkit") || r.stdout.includes("PolicyKit")) {
    findings.push({
      checkId: "LNX-DBUS-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "dbus",
      title: "PolicyKit D-Bus service available",
      details:
        "PolicyKit D-Bus interface is accessible — check for CVE-2021-3560 (polkit 0.113-0.118) timing attack for unauthorized privilege escalation",
      remediation: "Update polkit. Restrict D-Bus access via policy files.",
    })
  }

  if (r.stdout.includes("PackageKit")) {
    findings.push({
      checkId: "LNX-DBUS-002",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "dbus",
      title: "PackageKit D-Bus service available",
      details: "PackageKit is accessible — may allow package installation without full root in some configurations",
      remediation: "Restrict PackageKit D-Bus policy to authorized users only.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pipSetupAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== pip Setup Abuse ==="]

  const script = `
echo "--- pip running as root? ---"
ps aux 2>/dev/null | grep -E "[p]ip[3]? install" | head -5
echo ""
echo "--- pip/pip3 in cron (root) ---"
grep -rn "pip\|pip3" /etc/crontab /etc/cron.d/ /var/spool/cron/crontabs/root 2>/dev/null | grep -v "^#"
echo ""
echo "--- pip install paths ---"
python3 -c "import site; print('\n'.join(site.getsitepackages()))" 2>/dev/null
echo ""
echo "--- Writable pip install paths ---"
python3 -c "import site; [print(p) for p in site.getsitepackages()]" 2>/dev/null | while read -r p; do
  [ -d "$p" ] && [ -w "$p" ] && echo "[!] WRITABLE: $p"
done
echo ""
echo "--- setup.py in common locations ---"
find /opt /srv /var/www /home -name "setup.py" -writable 2>/dev/null | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("pip") && r.stdout.includes("root")) {
    findings.push({
      checkId: "LNX-PIP-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "pip",
      title: "pip runs as root",
      details:
        "pip install running as root in cron or active process — writable setup.py can execute arbitrary code as root",
      remediation: "Never run pip as root. Use virtual environments and --user flag.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE:")) {
    findings.push({
      checkId: "LNX-PIP-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "pip",
      title: "Writable pip site-packages directory",
      details: "Python site-packages directory is writable — inject malicious modules to be imported by root scripts",
      remediation: "Restrict site-packages permissions. Use virtual environments.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sharedLibHijack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Shared Library Hijack ==="]

  const script = `
echo "--- Missing libraries in SUID binaries ---"
find / -perm -4000 -type f 2>/dev/null | head -30 | while read -r f; do
  missing=$(ldd "$f" 2>/dev/null | grep "not found")
  [ -n "$missing" ] && echo "[!] $f: $missing"
done
echo ""
echo "--- Writable library directories (ld.so.conf) ---"
cat /etc/ld.so.conf /etc/ld.so.conf.d/* 2>/dev/null | grep -v "^#" | while read -r d; do
  [ -d "$d" ] && [ -w "$d" ] && echo "[!] WRITABLE: $d"
done
echo ""
echo "--- RPATH/RUNPATH in SUID binaries ---"
find / -perm -4000 -type f 2>/dev/null | head -20 | while read -r f; do
  rp=$(readelf -d "$f" 2>/dev/null | grep -E "RPATH|RUNPATH")
  [ -n "$rp" ] && echo "[!] $f: $rp"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("not found")) {
    findings.push({
      checkId: "LNX-SHLIB-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "shared_libs",
      title: "Missing shared library in SUID binary",
      details:
        "SUID binary references a missing shared library — create the .so file in a writable path to execute code as root",
      remediation: "Install missing libraries or recompile SUID binary. Remove SUID bit if not needed.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE:") && r.stdout.includes("ld.so")) {
    findings.push({
      checkId: "LNX-SHLIB-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "ld.so.conf",
      title: "Writable library directory",
      details:
        "Library directory in ld.so.conf is writable — place .so for preload by privileged processes after ldconfig",
      remediation: "Restrict library directory permissions to root-owned.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function logrotateRace(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Logrotate Race Condition ==="]

  const script = `
echo "--- logrotate version ---"
logrotate --version 2>&1 | head -1
echo ""
echo "--- logrotate config ---"
cat /etc/logrotate.conf 2>/dev/null | grep -vE "^#|^$" | head -20
echo ""
echo "--- User-writable log files rotated by logrotate ---"
for f in /etc/logrotate.d/*; do
  [ -f "$f" ] || continue
  grep -oP '^[/\w.-]+' "$f" 2>/dev/null | while read -r logfile; do
    [ -f "$logfile" ] && [ -w "$logfile" ] && echo "[!] WRITABLE LOG: $logfile (rotated by $f)"
  done
done
echo ""
echo "--- logrotate runs as ---"
grep -r "logrotate" /etc/crontab /etc/cron.d/ /etc/cron.daily/ 2>/dev/null | head -5
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE LOG:")) {
    findings.push({
      checkId: "LNX-LOGROTATE-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "logrotate",
      title: "User-writable log file under logrotate",
      details:
        "Logrotate processes a user-writable log file — race condition during rotation may allow writing to arbitrary files as root",
      remediation: "Restrict log file ownership to root or the logging service account.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function writableServiceBin(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Writable Service Binary Check ==="]

  const script = `
echo "--- Systemd services with writable ExecStart ---"
for unit in /etc/systemd/system/*.service /usr/lib/systemd/system/*.service /lib/systemd/system/*.service; do
  [ -f "$unit" ] || continue
  bin=$(grep "^ExecStart=" "$unit" 2>/dev/null | head -1 | cut -d= -f2 | awk '{print $1}' | sed 's/^-//')
  [ -n "$bin" ] && [ -f "$bin" ] && [ -w "$bin" ] && echo "[!] WRITABLE: $bin (unit: $unit)"
done
echo ""
echo "--- Init.d scripts with writable targets ---"
for script in /etc/init.d/*; do
  [ -f "$script" ] || continue
  [ -w "$script" ] && echo "[!] WRITABLE INIT SCRIPT: $script"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE:")) {
    const writable = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-WRITSVC-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "services",
      title: "Writable service binary",
      details: `${writable.length} writable service binary/binaries: ${writable[0]?.replace("[!] WRITABLE: ", "")} — replace binary to execute as root on service restart`,
      remediation: "Ensure service binaries are root-owned with 755 permissions.",
    })
  }

  if (r.stdout.includes("[!] WRITABLE INIT SCRIPT:")) {
    findings.push({
      checkId: "LNX-WRITSVC-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "init.d",
      title: "Writable init.d script",
      details: "Init.d script is writable — inject commands to execute as root on service start/stop/restart",
      remediation: "Set init.d scripts to root:root 755.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function polkitBypass(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Polkit Bypass Check ==="]

  const script = `
echo "--- polkit version ---"
pkaction --version 2>/dev/null || dpkg -l policykit-1 2>/dev/null | tail -1 || rpm -q polkit 2>/dev/null
echo ""
echo "--- pkexec SUID check ---"
ls -la $(which pkexec 2>/dev/null) 2>/dev/null
echo ""
echo "--- polkitd process ---"
ps aux 2>/dev/null | grep -E "[p]olkit"
echo ""
echo "--- Polkit rules ---"
ls -la /etc/polkit-1/rules.d/ /usr/share/polkit-1/rules.d/ 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const versionMatch = r.stdout.match(/(\d+\.\d+)/)
  if (versionMatch) {
    const ver = parseFloat(versionMatch[1])
    if (ver >= 0.113 && ver <= 0.118) {
      findings.push({
        checkId: "LNX-POLKIT-001",
        provider: "linuxhook",
        severity: "CRITICAL",
        status: "VULNERABLE",
        resource: "polkit",
        title: "CVE-2021-3560 — polkit timing attack",
        details: `polkit version ${ver} is vulnerable to CVE-2021-3560 — send dbus request and kill it at the right moment to bypass authentication`,
        remediation: "Update polkit to version 0.119 or later.",
      })
    }
  }

  if (r.stdout.includes("-rwsr") || r.stdout.includes("rws")) {
    findings.push({
      checkId: "LNX-POLKIT-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "pkexec",
      title: "pkexec has SUID bit",
      details: "pkexec SUID is set — check for CVE-2021-4034 (PwnKit) exploitation",
      remediation: "Remove SUID from pkexec if not needed: chmod 0755 $(which pkexec).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function snapPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Snap Privilege Escalation ==="]

  const script = `
echo "--- snap version ---"
snap version 2>/dev/null || echo "snap not installed"
echo ""
echo "--- snapd version ---"
snap version 2>/dev/null | grep snapd
echo ""
echo "--- Installed snaps ---"
snap list 2>/dev/null | head -20
echo ""
echo "--- Snap confinement ---"
snap debug confinement 2>/dev/null
echo ""
echo "--- snapd socket ---"
ls -la /run/snapd.socket 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("snap not installed")) return { output: output.join("\n"), findings }

  const snapdMatch = r.stdout.match(/snapd\s+(\d+\.\d+)/)
  if (snapdMatch) {
    const ver = parseFloat(snapdMatch[1])
    if (ver < 2.37) {
      findings.push({
        checkId: "LNX-SNAP-001",
        provider: "linuxhook",
        severity: "HIGH",
        status: "VULNERABLE",
        resource: "snapd",
        title: "dirty_sock (CVE-2019-7304) — snapd < 2.37",
        details: `snapd ${ver} is vulnerable to dirty_sock — exploit snapd API to create local admin user`,
        remediation: "Update snapd to 2.37 or later.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dockerGroupEscape(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Docker Group Escape ==="]

  const script = `
echo "--- Current user groups ---"
id
echo ""
echo "--- Docker group check ---"
id | grep -oE "(docker|podman)" && echo "[+] User is in docker/podman group" || echo "[-] User is NOT in docker/podman group"
echo ""
echo "--- Docker socket ---"
ls -la /var/run/docker.sock 2>/dev/null
echo ""
echo "--- Docker accessible ---"
docker ps 2>/dev/null && echo "[+] Docker is accessible" || echo "[-] Docker not accessible"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] User is in docker/podman group") || r.stdout.includes("[+] Docker is accessible")) {
    findings.push({
      checkId: "LNX-DOCKERGRP-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "docker",
      title: "Docker group membership — root equivalent",
      details:
        "Current user can access Docker — run: docker run -v /:/host -it alpine chroot /host to get full root access on host",
      remediation: "Remove user from docker group. Use rootless Docker or Podman instead.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function lxdGroupEscape(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== LXD/LXC Group Escape ==="]

  const script = `
echo "--- Current user groups ---"
id
echo ""
echo "--- LXD/LXC group check ---"
id | grep -oE "(lxd|lxc)" && echo "[+] User is in lxd/lxc group" || echo "[-] User is NOT in lxd/lxc group"
echo ""
echo "--- LXD available ---"
which lxd lxc 2>/dev/null
lxc list 2>/dev/null && echo "[+] LXC is accessible" || echo "[-] LXC not accessible"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] User is in lxd/lxc group") || r.stdout.includes("[+] LXC is accessible")) {
    findings.push({
      checkId: "LNX-LXDGRP-001",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "lxd",
      title: "LXD/LXC group membership — root equivalent",
      details:
        "Current user can access LXD/LXC — init storage pool, launch privileged container with host / mounted, chroot to host root",
      remediation: "Remove user from lxd/lxc group unless container management is required.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pythonLibHijack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Python Library Hijack ==="]

  const script = `
echo "--- Python sys.path ---"
python3 -c "import sys; print('\n'.join(sys.path))" 2>/dev/null
echo ""
echo "--- Writable Python paths ---"
python3 -c "import sys; [print(p) for p in sys.path if p]" 2>/dev/null | while read -r p; do
  [ -d "$p" ] && [ -w "$p" ] && echo "[!] WRITABLE: $p"
done
echo ""
echo "--- Root Python scripts ---"
find /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ /var/spool/cron/ -name "*.py" 2>/dev/null
grep -rl "python" /etc/crontab /etc/cron.d/* 2>/dev/null | head -5
echo ""
echo "--- Python scripts run by systemd as root ---"
grep -rl "python" /etc/systemd/system/*.service /usr/lib/systemd/system/*.service 2>/dev/null | head -5
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE:")) {
    const writable = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-PYLIB-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "python",
      title: "Writable Python module path",
      details: `${writable.length} writable directory/directories in Python sys.path: ${writable[0]?.replace("[!] WRITABLE: ", "")} — place malicious module to be imported by root scripts`,
      remediation: "Restrict Python sys.path directories to root ownership. Use virtual environments.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function motdAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== MOTD Abuse ==="]

  const script = `
echo "--- /etc/update-motd.d/ ---"
ls -la /etc/update-motd.d/ 2>/dev/null
echo ""
echo "--- Writable MOTD scripts ---"
for f in /etc/update-motd.d/*; do
  [ -f "$f" ] && [ -w "$f" ] && echo "[!] WRITABLE: $f"
done
echo ""
echo "--- MOTD ownership ---"
stat -c "%U:%G %a %n" /etc/update-motd.d/* 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] WRITABLE:")) {
    const writable = r.stdout.split("\n").filter((l) => l.includes("[!] WRITABLE:"))
    findings.push({
      checkId: "LNX-MOTD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "motd",
      title: "Writable MOTD scripts",
      details: `${writable.length} writable script(s) in /etc/update-motd.d/: ${writable[0]?.replace("[!] WRITABLE: ", "")} — these run as root on every SSH login`,
      remediation: "Set MOTD scripts to root:root 755.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function wildcardInjection(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Wildcard Injection ==="]

  const script = `
echo "--- tar with wildcard in cron/scripts ---"
grep -rnE "tar .* \\*|tar .* \\." /etc/crontab /etc/cron.d/* /etc/cron.daily/* /etc/cron.hourly/* 2>/dev/null | grep -v "^#"
echo ""
echo "--- rsync with wildcard ---"
grep -rnE "rsync .* \\*" /etc/crontab /etc/cron.d/* /etc/cron.daily/* /etc/cron.hourly/* 2>/dev/null | grep -v "^#"
echo ""
echo "--- chown/chmod with wildcard ---"
grep -rnE "(chown|chmod) .* \\*" /etc/crontab /etc/cron.d/* /etc/cron.daily/* /etc/cron.hourly/* 2>/dev/null | grep -v "^#"
echo ""
echo "--- Systemd services with wildcards ---"
grep -rnE "(tar|rsync|chown|chmod) .* \\*" /etc/systemd/system/*.service 2>/dev/null | grep -v "^#"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.match(/tar .* \*/)) {
    findings.push({
      checkId: "LNX-WILDCARD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "cron",
      title: "tar wildcard injection",
      details:
        "tar command uses wildcard — create files named --checkpoint=1 and --checkpoint-action=exec=sh payload.sh for code execution",
      remediation: "Use explicit file lists instead of wildcards. Quote arguments properly.",
    })
  }

  if (r.stdout.match(/rsync .* \*/)) {
    findings.push({
      checkId: "LNX-WILDCARD-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "cron",
      title: "rsync wildcard injection",
      details: "rsync command uses wildcard — create file named -e sh payload.sh for code execution",
      remediation: "Use explicit file lists instead of wildcards.",
    })
  }

  if (r.stdout.match(/(chown|chmod) .* \*/)) {
    findings.push({
      checkId: "LNX-WILDCARD-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "VULNERABLE",
      resource: "cron",
      title: "chown/chmod wildcard injection",
      details:
        "chown/chmod uses wildcard — create file named --reference=attacker_file to change permissions/ownership",
      remediation: "Use explicit file lists. Run with -- before arguments.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function mysqlUdf(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== MySQL UDF Privilege Escalation ==="]

  const script = `
echo "--- MySQL/MariaDB running ---"
ps aux 2>/dev/null | grep -E "[m]ysql|[m]ariadb"
echo ""
echo "--- MySQL running as ---"
ps aux 2>/dev/null | grep -E "[m]ysqld" | awk '{print $1}' | sort -u
echo ""
echo "--- MySQL plugin_dir ---"
mysql -e "SELECT @@plugin_dir;" 2>/dev/null || mysqld --verbose --help 2>/dev/null | grep plugin-dir | head -1
echo ""
echo "--- Plugin dir permissions ---"
plugin_dir=$(mysql -e "SELECT @@plugin_dir;" 2>/dev/null | tail -1)
[ -n "$plugin_dir" ] && ls -la "$plugin_dir" 2>/dev/null && [ -w "$plugin_dir" ] && echo "[!] plugin_dir is WRITABLE"
echo ""
echo "--- MySQL as root check ---"
ps aux 2>/dev/null | grep -E "[m]ysqld" | grep root && echo "[!] MySQL running as root"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[!] MySQL running as root")) {
    findings.push({
      checkId: "LNX-MYSQLUDF-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "mysql",
      title: "MySQL running as root",
      details:
        "MySQL/MariaDB is running as root — upload UDF shared library (raptor_udf2.so) to plugin_dir, CREATE FUNCTION sys_exec, call it for root shell",
      remediation: "Run MySQL as dedicated mysql user, never as root.",
    })
  }

  if (r.stdout.includes("[!] plugin_dir is WRITABLE")) {
    findings.push({
      checkId: "LNX-MYSQLUDF-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "mysql",
      title: "MySQL plugin directory writable",
      details: "MySQL plugin_dir is writable — can upload UDF .so for command execution as the MySQL service user",
      remediation: "Restrict plugin_dir to mysql:mysql 755.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ptraceScopeCheck(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Ptrace Scope Check ==="]

  const script = `
echo "--- YAMA ptrace_scope ---"
cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null
echo ""
echo "--- ptrace_scope meaning ---"
val=$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null)
case "$val" in
  0) echo "0 = classic ptrace — any process can ptrace any other (PERMISSIVE)" ;;
  1) echo "1 = restricted — only parent can ptrace child (DEFAULT)" ;;
  2) echo "2 = admin-only — only CAP_SYS_PTRACE can ptrace" ;;
  3) echo "3 = no-attach — ptrace completely disabled" ;;
  *) echo "Unknown or YAMA not available" ;;
esac
echo ""
echo "--- process_vm_readv capability ---"
cat /proc/self/status 2>/dev/null | grep -i "cap"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const val = r.stdout.split("\n")[0]?.trim()
  if (val === "0") {
    findings.push({
      checkId: "LNX-PTRACE-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "VULNERABLE",
      resource: "kernel",
      title: "ptrace_scope is 0 — classic permissive mode",
      details:
        "Any process can ptrace any other process — enables credential extraction from sshd/sudo, process injection, and debugging attacks",
      remediation: "Set kernel.yama.ptrace_scope=1 or higher in /etc/sysctl.conf.",
    })
  }

  return { output: output.join("\n"), findings }
}
