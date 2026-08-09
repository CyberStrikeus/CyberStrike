import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function systemInfo(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== System Information ==="]

  const script = `
echo "--- Hostname ---"
hostname -f 2>/dev/null || hostname
echo ""
echo "--- OS Release ---"
cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null
echo ""
echo "--- Kernel ---"
uname -a
echo ""
echo "--- Uptime ---"
uptime
echo ""
echo "--- CPU ---"
lscpu 2>/dev/null | grep -E "^(Architecture|CPU|Model name|Thread|Core|Socket|Vendor)" || cat /proc/cpuinfo | head -20
echo ""
echo "--- Memory ---"
free -h 2>/dev/null || cat /proc/meminfo | head -5
echo ""
echo "--- Disk ---"
df -h 2>/dev/null | grep -vE "^(tmpfs|devtmpfs|overlay)" || mount
echo ""
echo "--- Network Interfaces ---"
ip -br addr 2>/dev/null || ifconfig 2>/dev/null || cat /proc/net/if_inet6 /proc/net/dev 2>/dev/null
echo ""
echo "--- Default Gateway ---"
ip route show default 2>/dev/null || route -n 2>/dev/null | grep "^0.0.0.0"
echo ""
echo "--- DNS ---"
cat /etc/resolv.conf 2>/dev/null | grep -v "^#"
echo ""
echo "--- Timezone ---"
timedatectl 2>/dev/null | grep "Time zone" || cat /etc/timezone 2>/dev/null || date +%Z
echo ""
echo "--- Environment ---"
echo "PATH=$PATH"
echo "USER=$(whoami)"
echo "HOME=$HOME"
echo "LANG=$LANG"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const lines = r.stdout.toLowerCase()
  if (lines.includes("kernel") || r.exitCode === 0) {
    findings.push({
      checkId: "LNX-SYSINFO-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "system",
      title: "System information enumerated",
      details: `Host system enumerated — kernel, distro, CPU, memory, disk, network configuration collected`,
      remediation: "Restrict access to system information commands for non-privileged users where possible",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function processEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Process Enumeration ==="]

  const script = `
echo "--- Running Processes (tree) ---"
ps auxf 2>/dev/null || ps aux 2>/dev/null
echo ""
echo "--- Processes running as root ---"
ps -eo pid,user,comm,args 2>/dev/null | grep "^\\s*[0-9]\\+\\s\\+root" | head -50
echo ""
echo "--- Listening Ports & Associated Processes ---"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null
echo ""
echo "--- Established Connections ---"
ss -tnp 2>/dev/null | grep ESTAB | head -30
echo ""
echo "--- Processes with open files (interesting) ---"
ls -la /proc/*/fd 2>/dev/null | grep -E "(socket|pipe|/tmp|/dev/shm)" | head -30
echo ""
echo "--- Cron-spawned processes ---"
ps -eo pid,user,comm,args 2>/dev/null | grep -iE "(cron|atd|anacron)" 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const rootProcs = (r.stdout.match(/root/g) || []).length
  if (rootProcs > 0) {
    findings.push({
      checkId: "LNX-PROCS-001",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "processes",
      title: "Process tree enumerated",
      details: `${rootProcs} root-context references found in process listing — review for exploitable services`,
      remediation: "Minimize services running as root; use dedicated service accounts",
    })
  }

  if (r.stdout.includes("LISTEN")) {
    const listeners = (r.stdout.match(/LISTEN/g) || []).length
    findings.push({
      checkId: "LNX-PROCS-002",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "network",
      title: "Listening services detected",
      details: `${listeners} listening port(s) found — potential attack surface for lateral movement or privilege escalation`,
      remediation: "Disable unnecessary listening services and restrict bindings to localhost where possible",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function networkEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Network Enumeration ==="]

  const script = `
echo "--- Interfaces ---"
ip -4 addr show 2>/dev/null || ifconfig 2>/dev/null
echo ""
echo "--- IPv6 Interfaces ---"
ip -6 addr show 2>/dev/null
echo ""
echo "--- Routing Table ---"
ip route show 2>/dev/null || route -n 2>/dev/null
echo ""
echo "--- ARP Table ---"
ip neigh show 2>/dev/null || arp -an 2>/dev/null
echo ""
echo "--- DNS Configuration ---"
cat /etc/resolv.conf 2>/dev/null
echo ""
echo "--- /etc/hosts ---"
cat /etc/hosts 2>/dev/null
echo ""
echo "--- Listening Ports ---"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null
echo ""
echo "--- UDP Listeners ---"
ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null
echo ""
echo "--- Firewall Rules (iptables) ---"
iptables -L -n -v 2>/dev/null || echo "iptables: permission denied or not available"
echo ""
echo "--- Firewall Rules (nftables) ---"
nft list ruleset 2>/dev/null || echo "nftables: not available"
echo ""
echo "--- UFW Status ---"
ufw status verbose 2>/dev/null || echo "ufw: not available"
echo ""
echo "--- Network Namespaces ---"
ip netns list 2>/dev/null
echo ""
echo "--- VPN / Tunnel Interfaces ---"
ip link show type tun 2>/dev/null
ip link show type tap 2>/dev/null
ip link show type wireguard 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const interfaces = (r.stdout.match(/inet /g) || []).length
  findings.push({
    checkId: "LNX-NETWORK-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "network",
    title: "Network configuration enumerated",
    details: `${interfaces} network interface(s) with IPv4 addresses detected — routing, ARP, DNS, and firewall rules collected`,
    remediation: "Segment networks and restrict inter-VLAN routing; apply host-based firewall rules",
  })

  if (r.stdout.includes("permission denied") || r.stdout.includes("not available")) {
    findings.push({
      checkId: "LNX-NETWORK-002",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "firewall",
      title: "Firewall rules not accessible",
      details: "Firewall rules could not be enumerated — may require root privileges",
      remediation: "N/A — run with elevated privileges for full network enumeration",
    })
  }

  if (r.stdout.includes("0.0.0.0:") || r.stdout.includes("*:")) {
    findings.push({
      checkId: "LNX-NETWORK-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "services",
      title: "Services bound to all interfaces",
      details: "One or more services listen on 0.0.0.0 (all interfaces) — accessible from any network segment",
      remediation: "Bind services to specific interfaces or localhost unless external access is required",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function userEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== User Enumeration ==="]

  const script = `
echo "--- Current User ---"
id
echo ""
echo "--- Users with shells ---"
grep -vE "(nologin|false|sync|halt|shutdown)" /etc/passwd 2>/dev/null
echo ""
echo "--- All Users ---"
cat /etc/passwd 2>/dev/null
echo ""
echo "--- Groups ---"
cat /etc/group 2>/dev/null
echo ""
echo "--- Sudoers ---"
cat /etc/sudoers 2>/dev/null 2>&1
echo ""
echo "--- Sudoers.d ---"
ls -la /etc/sudoers.d/ 2>/dev/null
for f in /etc/sudoers.d/*; do
  echo "-- $f --"
  cat "$f" 2>/dev/null
done
echo ""
echo "--- Currently Logged In ---"
w 2>/dev/null || who 2>/dev/null
echo ""
echo "--- Last Logins ---"
last -n 20 2>/dev/null
echo ""
echo "--- Failed Logins ---"
lastb -n 20 2>/dev/null || echo "lastb: permission denied"
echo ""
echo "--- Password Policy ---"
cat /etc/login.defs 2>/dev/null | grep -E "^(PASS_|LOGIN_|UID_|GID_)" 2>/dev/null
echo ""
echo "--- PAM Configuration ---"
ls -la /etc/pam.d/ 2>/dev/null
echo ""
echo "--- Users with empty passwords ---"
awk -F: '($2 == "" || $2 == "!") {print $1}' /etc/shadow 2>/dev/null || echo "Cannot read /etc/shadow"
echo ""
echo "--- Users with UID 0 ---"
awk -F: '$3 == 0 {print $1}' /etc/passwd 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const shellUsers = (r.stdout.match(/\/bin\/(bash|sh|zsh|fish|csh|tcsh|ksh)/g) || []).length
  findings.push({
    checkId: "LNX-USERS-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "users",
    title: "User accounts enumerated",
    details: `${shellUsers} user(s) with interactive shells found — review for unnecessary accounts or weak credentials`,
    remediation: "Remove unnecessary user accounts; set nologin shell for service accounts",
  })

  if (r.stdout.includes("NOPASSWD")) {
    findings.push({
      checkId: "LNX-USERS-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "sudoers",
      title: "NOPASSWD sudo entries found",
      details: "One or more users can execute sudo commands without a password — potential privilege escalation vector",
      remediation: "Remove NOPASSWD entries unless absolutely necessary; restrict allowed commands",
    })
  }

  const uid0Match = r.stdout.match(/Users with UID 0 ---\n([\s\S]*?)(\n---|$)/m)
  if (uid0Match) {
    const uid0Users = uid0Match[1].trim().split("\n").filter((l: string) => l.trim() && l.trim() !== "root")
    if (uid0Users.length > 0) {
      findings.push({
        checkId: "LNX-USERS-003",
        provider: "linuxhook",
        severity: "CRITICAL",
        status: "VULNERABLE",
        resource: "users",
        title: "Non-root users with UID 0",
        details: `Users with UID 0 besides root: ${uid0Users.join(", ")} — these have full root privileges`,
        remediation: "Remove UID 0 from non-root accounts; investigate potential backdoor accounts",
      })
    }
  }

  if (r.stdout.includes("empty passwords")) {
    const emptyPwSection = r.stdout.split("empty passwords ---")[1]
    if (emptyPwSection && !emptyPwSection.includes("Cannot read") && emptyPwSection.trim().split("\n").filter((l: string) => l.trim()).length > 0) {
      findings.push({
        checkId: "LNX-USERS-004",
        provider: "linuxhook",
        severity: "CRITICAL",
        status: "VULNERABLE",
        resource: "users",
        title: "Users with empty passwords",
        details: "One or more users have empty or disabled password hashes — login without password may be possible",
        remediation: "Set strong passwords or lock accounts with empty passwords",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function serviceEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Service Enumeration ==="]

  const script = `
echo "--- Systemd Services (running) ---"
systemctl list-units --type=service --state=running 2>/dev/null || echo "systemctl not available"
echo ""
echo "--- Systemd Services (enabled) ---"
systemctl list-unit-files --type=service --state=enabled 2>/dev/null
echo ""
echo "--- Systemd Timers ---"
systemctl list-timers --all 2>/dev/null
echo ""
echo "--- SysVinit Services ---"
service --status-all 2>/dev/null || chkconfig --list 2>/dev/null || echo "No SysVinit service manager found"
echo ""
echo "--- xinetd Services ---"
ls /etc/xinetd.d/ 2>/dev/null
echo ""
echo "--- Listening Ports → Services ---"
ss -tlnp 2>/dev/null | while read line; do
  echo "$line"
done
echo ""
echo "--- Socket Units ---"
systemctl list-sockets 2>/dev/null
echo ""
echo "--- Failed Services ---"
systemctl list-units --state=failed 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const running = (r.stdout.match(/running/gi) || []).length
  findings.push({
    checkId: "LNX-SERVICES-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "services",
    title: "Running services enumerated",
    details: `${running} running service references found — review for unnecessary or vulnerable services`,
    remediation: "Disable unnecessary services; keep all services updated to latest versions",
  })

  const dangerousServices = ["telnet", "rsh", "rlogin", "rexec", "ftp", "tftp", "finger", "talk"]
  const foundDangerous = dangerousServices.filter(s => r.stdout.toLowerCase().includes(s))
  if (foundDangerous.length > 0) {
    findings.push({
      checkId: "LNX-SERVICES-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "services",
      title: "Insecure legacy services detected",
      details: `Legacy insecure services found: ${foundDangerous.join(", ")} — these transmit credentials in cleartext`,
      remediation: "Replace with secure alternatives (SSH, SFTP); disable legacy services immediately",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function packageEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Package Enumeration ==="]

  const script = `
echo "--- Package Manager ---"
if command -v dpkg >/dev/null 2>&1; then
  echo "TYPE: dpkg/apt"
  echo "--- Installed Packages ---"
  dpkg -l 2>/dev/null | tail -n +6 | awk '{print $2, $3}' | head -200
  echo "--- Package Count ---"
  dpkg -l 2>/dev/null | tail -n +6 | wc -l
elif command -v rpm >/dev/null 2>&1; then
  echo "TYPE: rpm/yum/dnf"
  echo "--- Installed Packages ---"
  rpm -qa --queryformat '%{NAME} %{VERSION}-%{RELEASE}\n' 2>/dev/null | sort | head -200
  echo "--- Package Count ---"
  rpm -qa 2>/dev/null | wc -l
elif command -v pacman >/dev/null 2>&1; then
  echo "TYPE: pacman"
  echo "--- Installed Packages ---"
  pacman -Q 2>/dev/null | head -200
  echo "--- Package Count ---"
  pacman -Q 2>/dev/null | wc -l
elif command -v apk >/dev/null 2>&1; then
  echo "TYPE: apk"
  echo "--- Installed Packages ---"
  apk list --installed 2>/dev/null | head -200
  echo "--- Package Count ---"
  apk list --installed 2>/dev/null | wc -l
else
  echo "TYPE: unknown"
fi
echo ""
echo "--- Security Tools Installed ---"
for tool in nmap nikto sqlmap hydra john hashcat aircrack-ng metasploit-framework burpsuite wireshark tcpdump strace ltrace gdb radare2 binwalk foremost volatility impacket-scripts responder crackmapexec evil-winrm bloodhound; do
  command -v "$tool" >/dev/null 2>&1 && echo "FOUND: $tool"
done
echo ""
echo "--- Development Tools ---"
for tool in gcc g++ make cmake python3 python2 perl ruby go node java javac dotnet php; do
  command -v "$tool" >/dev/null 2>&1 && echo "FOUND: $tool ($(${tool} --version 2>&1 | head -1))"
done
echo ""
echo "--- Package Managers (dev) ---"
for pm in pip pip3 gem npm cargo composer; do
  command -v "$pm" >/dev/null 2>&1 && echo "FOUND: $pm"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const countMatch = r.stdout.match(/Package Count ---\n\s*(\d+)/m)
  const pkgCount = countMatch ? parseInt(countMatch[1]) : 0
  findings.push({
    checkId: "LNX-PACKAGES-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "packages",
    title: "Installed packages enumerated",
    details: `${pkgCount} packages installed — review for known vulnerabilities and outdated versions`,
    remediation: "Keep packages updated; remove unnecessary packages to reduce attack surface",
  })

  const secTools = (r.stdout.match(/FOUND: (nmap|nikto|sqlmap|hydra|john|hashcat|metasploit|responder|crackmapexec|evil-winrm|bloodhound)/g) || [])
  if (secTools.length > 0) {
    findings.push({
      checkId: "LNX-PACKAGES-002",
      provider: "linuxhook",
      severity: "INFO",
      status: "IDENTIFIED",
      resource: "tools",
      title: "Offensive security tools available",
      details: `${secTools.length} security tool(s) found on system — can be leveraged for further exploitation`,
      remediation: "Remove offensive security tools from production systems",
    })
  }

  const compilers = (r.stdout.match(/FOUND: (gcc|g\+\+|make|cmake)/g) || [])
  if (compilers.length > 0) {
    findings.push({
      checkId: "LNX-PACKAGES-003",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "tools",
      title: "Compilation tools available",
      details: `Compiler/build tools found — can compile kernel exploits or custom tools on target`,
      remediation: "Remove build tools from production systems; use separate build environments",
    })
  }

  return { output: output.join("\n"), findings }
}
