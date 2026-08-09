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

export async function containerDetect(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Container Detection ==="]

  const script = `
echo "--- Container Indicators ---"
echo "/.dockerenv exists: $([ -f /.dockerenv ] && echo YES || echo NO)"
echo "/run/.containerenv exists: $([ -f /run/.containerenv ] && echo YES || echo NO)"
echo ""
echo "--- cgroup Info ---"
cat /proc/1/cgroup 2>/dev/null
echo ""
echo "--- PID 1 ---"
cat /proc/1/cmdline 2>/dev/null | tr '\\0' ' '
echo ""
ls -la /proc/1/exe 2>/dev/null
echo ""
echo "--- Hostname ---"
hostname
echo ""
echo "--- /proc/version ---"
cat /proc/version 2>/dev/null
echo ""
echo "--- Namespace Info ---"
ls -la /proc/1/ns/ 2>/dev/null
echo ""
echo "--- Capabilities ---"
cat /proc/1/status 2>/dev/null | grep -i cap
echo ""
echo "--- Mounted Volumes ---"
mount 2>/dev/null | grep -vE "^(proc|sysfs|devpts|tmpfs|cgroup|mqueue|shm)"
echo ""
echo "--- Docker Socket ---"
ls -la /var/run/docker.sock 2>/dev/null && echo "DOCKER_SOCKET: ACCESSIBLE" || echo "DOCKER_SOCKET: NOT_FOUND"
echo ""
echo "--- Kubernetes ---"
echo "K8S_SERVICE_HOST: $KUBERNETES_SERVICE_HOST"
ls -la /var/run/secrets/kubernetes.io/ 2>/dev/null
cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null | head -c 50
echo ""
echo "--- Container Runtime ---"
cat /proc/1/cgroup 2>/dev/null | grep -oP '(docker|containerd|cri-o|lxc|podman)' | head -1
echo ""
echo "--- Escape Vectors ---"
echo "Privileged mode: $([ -w /sys/fs/cgroup ] && echo LIKELY || echo NO)"
echo "Host PID ns: $([ "$(ls /proc | wc -l)" -gt 100 ] && echo POSSIBLE || echo NO)"
echo "Host network: $(ip link show docker0 2>/dev/null && echo YES || echo NO)"
capsh --print 2>/dev/null | grep -i "current"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const isDocker = r.stdout.includes("/.dockerenv exists: YES") || r.stdout.includes("docker")
  const isPodman = r.stdout.includes("/run/.containerenv exists: YES") || r.stdout.includes("podman")
  const isLxc = r.stdout.includes("lxc")
  const isWsl = r.stdout.toLowerCase().includes("microsoft")
  const isK8s = r.stdout.includes("KUBERNETES_SERVICE_HOST") && !r.stdout.includes("K8S_SERVICE_HOST: \n")
  const inContainer = isDocker || isPodman || isLxc || isWsl || isK8s

  const containerType = isK8s ? "kubernetes" : isDocker ? "docker" : isPodman ? "podman" : isLxc ? "lxc" : isWsl ? "wsl" : "none"

  findings.push({
    checkId: "LNX-CONTAINER-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "container",
    title: inContainer ? `Running inside ${containerType} container` : "Not running in a container",
    details: inContainer
      ? `Container type: ${containerType} — check for escape vectors and mounted sensitive paths`
      : "Host system detected — not containerized",
    remediation: inContainer ? "Use containerhook for container-specific exploitation" : "N/A",
  })

  if (r.stdout.includes("DOCKER_SOCKET: ACCESSIBLE")) {
    findings.push({
      checkId: "LNX-CONTAINER-002",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "docker.sock",
      title: "Docker socket accessible from container",
      details: "Docker socket (/var/run/docker.sock) is mounted — full container escape possible via docker run with host mount",
      remediation: "Never mount Docker socket into containers; use Docker-in-Docker with rootless mode",
    })
  }

  if (r.stdout.includes("Privileged mode: LIKELY")) {
    findings.push({
      checkId: "LNX-CONTAINER-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "container",
      title: "Container running in privileged mode",
      details: "Container appears to be running with --privileged — cgroup writable, full host access possible",
      remediation: "Never use --privileged in production; use specific capabilities instead",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function securityFramework(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Security Framework Analysis ==="]

  const script = `
echo "--- SELinux ---"
getenforce 2>/dev/null || echo "getenforce: not available"
sestatus 2>/dev/null || echo "sestatus: not available"
echo ""
echo "--- AppArmor ---"
aa-status 2>/dev/null || echo "aa-status: not available"
cat /sys/kernel/security/apparmor/profiles 2>/dev/null | head -20
echo ""
echo "--- Seccomp ---"
grep -i seccomp /proc/1/status 2>/dev/null
echo ""
echo "--- YAMA ptrace_scope ---"
cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo "YAMA: not available"
echo ""
echo "--- Kernel Hardening ---"
echo "ASLR: $(cat /proc/sys/kernel/randomize_va_space 2>/dev/null)"
echo "kptr_restrict: $(cat /proc/sys/kernel/kptr_restrict 2>/dev/null)"
echo "dmesg_restrict: $(cat /proc/sys/kernel/dmesg_restrict 2>/dev/null)"
echo "perf_event_paranoid: $(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null)"
echo "unprivileged_bpf_disabled: $(cat /proc/sys/kernel/unprivileged_bpf_disabled 2>/dev/null)"
echo "modules_disabled: $(cat /proc/sys/kernel/modules_disabled 2>/dev/null)"
echo "kexec_load_disabled: $(cat /proc/sys/kernel/kexec_load_disabled 2>/dev/null)"
echo ""
echo "--- sysctl Security ---"
echo "ip_forward: $(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)"
echo "accept_redirects: $(cat /proc/sys/net/ipv4/conf/all/accept_redirects 2>/dev/null)"
echo "send_redirects: $(cat /proc/sys/net/ipv4/conf/all/send_redirects 2>/dev/null)"
echo "accept_source_route: $(cat /proc/sys/net/ipv4/conf/all/accept_source_route 2>/dev/null)"
echo "syncookies: $(cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null)"
echo ""
echo "--- Audit System ---"
auditctl -l 2>/dev/null || echo "auditctl: not available or no rules"
auditctl -s 2>/dev/null
echo ""
echo "--- Integrity Checking ---"
command -v aide >/dev/null 2>&1 && echo "AIDE: installed" || echo "AIDE: not installed"
command -v tripwire >/dev/null 2>&1 && echo "Tripwire: installed" || echo "Tripwire: not installed"
command -v osquery >/dev/null 2>&1 && echo "osquery: installed" || echo "osquery: not installed"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("Disabled") || r.stdout.includes("disabled") || r.stdout.includes("getenforce: not available")) {
    if (!r.stdout.includes("Enforcing")) {
      findings.push({
        checkId: "LNX-SECFW-001",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "VULNERABLE",
        resource: "selinux",
        title: "SELinux not enforcing",
        details: "SELinux is disabled or in permissive mode — mandatory access controls are not active",
        remediation: "Enable SELinux in enforcing mode with appropriate policies",
      })
    }
  }

  if (r.stdout.includes("aa-status: not available") && !r.stdout.includes("apparmor")) {
    findings.push({
      checkId: "LNX-SECFW-002",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "apparmor",
      title: "AppArmor not detected",
      details: "AppArmor is not installed or not active — no application confinement in place",
      remediation: "Install and configure AppArmor profiles for critical services",
    })
  }

  const ptraceScope = r.stdout.match(/ptrace_scope.*\n\s*(\d)/m) || r.stdout.match(/YAMA ptrace_scope ---\n(\d)/m)
  if (ptraceScope && ptraceScope[1] === "0") {
    findings.push({
      checkId: "LNX-SECFW-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "VULNERABLE",
      resource: "kernel",
      title: "YAMA ptrace_scope is 0 (permissive)",
      details: "Any process can ptrace any other process owned by the same user — enables credential extraction and process injection",
      remediation: "Set kernel.yama.ptrace_scope=1 or higher in /etc/sysctl.conf",
    })
  }

  const aslr = r.stdout.match(/ASLR: (\d)/m)
  if (aslr && aslr[1] !== "2") {
    findings.push({
      checkId: "LNX-SECFW-004",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "kernel",
      title: `ASLR not fully enabled (level ${aslr[1]})`,
      details: "Address Space Layout Randomization is not at maximum (2) — memory corruption exploits are easier",
      remediation: "Set kernel.randomize_va_space=2 in /etc/sysctl.conf",
    })
  }

  const kptrRestrict = r.stdout.match(/kptr_restrict: (\d)/m)
  if (kptrRestrict && kptrRestrict[1] === "0") {
    findings.push({
      checkId: "LNX-SECFW-005",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "VULNERABLE",
      resource: "kernel",
      title: "Kernel pointer addresses exposed",
      details: "kptr_restrict=0 — kernel symbols in /proc/kallsyms are visible, aiding kernel exploit development",
      remediation: "Set kernel.kptr_restrict=1 or 2 in /etc/sysctl.conf",
    })
  }

  const dmesgRestrict = r.stdout.match(/dmesg_restrict: (\d)/m)
  if (dmesgRestrict && dmesgRestrict[1] === "0") {
    findings.push({
      checkId: "LNX-SECFW-006",
      provider: "linuxhook",
      severity: "LOW",
      status: "VULNERABLE",
      resource: "kernel",
      title: "dmesg accessible to unprivileged users",
      details: "dmesg_restrict=0 — kernel log messages are readable by all users, may leak sensitive information",
      remediation: "Set kernel.dmesg_restrict=1 in /etc/sysctl.conf",
    })
  }

  const ipForward = r.stdout.match(/ip_forward: (\d)/m)
  if (ipForward && ipForward[1] === "1") {
    findings.push({
      checkId: "LNX-SECFW-007",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "VULNERABLE",
      resource: "network",
      title: "IP forwarding enabled",
      details: "net.ipv4.ip_forward=1 — this host can route traffic between networks, enabling MITM attacks",
      remediation: "Disable IP forwarding unless this is a router/gateway: net.ipv4.ip_forward=0",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function interestingFiles(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Interesting Files ==="]
  const depth = argVal(args, "--depth") || "3"

  const script = `
echo "--- SUID Binaries ---"
find / -perm -4000 -type f 2>/dev/null | head -50
echo ""
echo "--- SGID Binaries ---"
find / -perm -2000 -type f 2>/dev/null | head -30
echo ""
echo "--- World-Writable Files (non-tmp) ---"
find / -writable -type f ! -path "/proc/*" ! -path "/sys/*" ! -path "/tmp/*" ! -path "/dev/*" ! -path "/run/*" 2>/dev/null | head -30
echo ""
echo "--- World-Writable Directories ---"
find / -writable -type d ! -path "/proc/*" ! -path "/sys/*" ! -path "/tmp/*" ! -path "/dev/*" ! -path "/run/*" 2>/dev/null | head -20
echo ""
echo "--- Writable PATH Directories ---"
echo "$PATH" | tr ':' '\\n' | while read dir; do
  [ -w "$dir" ] && echo "WRITABLE: $dir"
done
echo ""
echo "--- /etc/shadow Permissions ---"
ls -la /etc/shadow 2>/dev/null
echo ""
echo "--- /etc/passwd Permissions ---"
ls -la /etc/passwd 2>/dev/null
echo ""
echo "--- SSH Keys ---"
find / -name "id_rsa" -o -name "id_ecdsa" -o -name "id_ed25519" -o -name "id_dsa" 2>/dev/null | head -20
find / -name "authorized_keys" 2>/dev/null | head -10
echo ""
echo "--- Backup Files ---"
find / -maxdepth ${depth} \\( -name "*.bak" -o -name "*.old" -o -name "*.orig" -o -name "*.swp" -o -name "*.swo" -o -name "*~" -o -name "*.save" \\) -type f 2>/dev/null | head -20
echo ""
echo "--- Config Files with Potential Credentials ---"
find / -maxdepth ${depth} \\( -name "*.conf" -o -name "*.cfg" -o -name "*.ini" -o -name "*.env" -o -name ".env" -o -name "*.properties" \\) -type f -readable 2>/dev/null | head -30
echo ""
echo "--- Database Files ---"
find / -maxdepth ${depth} \\( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.mdb" \\) -type f 2>/dev/null | head -15
echo ""
echo "--- Log Files (writable) ---"
find /var/log -writable -type f 2>/dev/null | head -15
echo ""
echo "--- Core Dumps ---"
find / -maxdepth 3 -name "core" -o -name "core.*" 2>/dev/null | head -5
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const suidSection = r.stdout.split("SUID Binaries ---")[1]?.split("---")[0] || ""
  const suidCount = suidSection.trim().split("\n").filter((l: string) => l.trim()).length
  if (suidCount > 0) {
    findings.push({
      checkId: "LNX-FILES-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "IDENTIFIED",
      resource: "filesystem",
      title: `${suidCount} SUID binaries found`,
      details: `${suidCount} SUID binary(ies) detected — check against GTFOBins for privilege escalation opportunities`,
      remediation: "Remove SUID bit from binaries that don't require it; audit SUID binaries regularly",
    })
  }

  if (r.stdout.includes("WRITABLE:")) {
    const writablePaths = (r.stdout.match(/WRITABLE: .+/g) || []).map((l: string) => l.replace("WRITABLE: ", ""))
    findings.push({
      checkId: "LNX-FILES-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "VULNERABLE",
      resource: "filesystem",
      title: "Writable directories in PATH",
      details: `User can write to PATH directories: ${writablePaths.join(", ")} — enables binary hijacking`,
      remediation: "Fix permissions on PATH directories; ensure only root can write to system paths",
    })
  }

  const shadowPerms = r.stdout.match(/shadow Permissions ---\n(.+)/m)
  if (shadowPerms && (shadowPerms[1].includes("-r--r--") || shadowPerms[1].includes("-rw-r--") || shadowPerms[1].includes("rw-rw"))) {
    findings.push({
      checkId: "LNX-FILES-003",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "/etc/shadow",
      title: "/etc/shadow is world-readable",
      details: "Shadow file is readable by non-root users — password hashes can be extracted for offline cracking",
      remediation: "Fix permissions: chmod 640 /etc/shadow; chown root:shadow /etc/shadow",
    })
  }

  const sshKeys = r.stdout.split("SSH Keys ---")[1]?.split("---")[0] || ""
  const keyCount = sshKeys.trim().split("\n").filter((l: string) => l.trim() && l.includes("id_")).length
  if (keyCount > 0) {
    findings.push({
      checkId: "LNX-FILES-004",
      provider: "linuxhook",
      severity: "HIGH",
      status: "IDENTIFIED",
      resource: "ssh",
      title: `${keyCount} SSH private key(s) found`,
      details: `${keyCount} SSH private key file(s) discovered — can be used for lateral movement to other hosts`,
      remediation: "Protect SSH keys with strong passphrases; use SSH agent with timeout; rotate keys regularly",
    })
  }

  const backupSection = r.stdout.split("Backup Files ---")[1]?.split("---")[0] || ""
  const backupCount = backupSection.trim().split("\n").filter((l: string) => l.trim()).length
  if (backupCount > 0) {
    findings.push({
      checkId: "LNX-FILES-005",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "filesystem",
      title: `${backupCount} backup/swap files found`,
      details: `${backupCount} backup file(s) found — may contain previous versions of configs with credentials`,
      remediation: "Remove unnecessary backup files; implement proper backup policies",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function mountEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Mount Enumeration ==="]

  const script = `
echo "--- Current Mounts ---"
mount 2>/dev/null | grep -vE "^(proc|sysfs|devpts|cgroup|securityfs|debugfs|pstore|bpf|tracefs|hugetlbfs|mqueue|configfs|fusectl)"
echo ""
echo "--- /etc/fstab ---"
cat /etc/fstab 2>/dev/null | grep -v "^#"
echo ""
echo "--- findmnt (tree) ---"
findmnt -t ext2,ext3,ext4,xfs,btrfs,nfs,cifs,tmpfs,vfat 2>/dev/null || echo "findmnt not available"
echo ""
echo "--- NFS Shares (exported) ---"
cat /etc/exports 2>/dev/null || echo "No /etc/exports"
showmount -e localhost 2>/dev/null || echo "showmount not available"
echo ""
echo "--- NFS Mounts (active) ---"
mount | grep nfs 2>/dev/null
echo ""
echo "--- CIFS/SMB Mounts ---"
mount | grep cifs 2>/dev/null
echo ""
echo "--- tmpfs Mounts ---"
mount | grep tmpfs 2>/dev/null | grep -v "^tmpfs on /sys"
echo ""
echo "--- Mounts without nosuid ---"
mount 2>/dev/null | grep -vE "(nosuid|proc|sys|cgroup|devpts|securityfs|debugfs)" | grep -v "^$"
echo ""
echo "--- Mounts without noexec ---"
mount 2>/dev/null | grep -vE "(noexec|proc|sys|cgroup|devpts|securityfs|debugfs)" | grep -v "^$"
echo ""
echo "--- /dev/shm ---"
ls -la /dev/shm/ 2>/dev/null
mount | grep "/dev/shm" 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  findings.push({
    checkId: "LNX-MOUNTS-001",
    provider: "linuxhook",
    severity: "INFO",
    status: "IDENTIFIED",
    resource: "filesystem",
    title: "Mount points enumerated",
    details: "Filesystem mounts, fstab, NFS/CIFS shares, and mount options collected",
    remediation: "Review mount options and ensure nosuid,noexec on non-system partitions",
  })

  if (r.stdout.includes("no_root_squash")) {
    findings.push({
      checkId: "LNX-MOUNTS-002",
      provider: "linuxhook",
      severity: "CRITICAL",
      status: "VULNERABLE",
      resource: "nfs",
      title: "NFS export with no_root_squash",
      details: "NFS share exported with no_root_squash — remote root can create SUID binaries for local privilege escalation",
      remediation: "Remove no_root_squash from /etc/exports; use root_squash (default)",
    })
  }

  const noSuidSection = r.stdout.split("without nosuid ---")[1]?.split("---")[0] || ""
  const noSuidMounts = noSuidSection.trim().split("\n").filter((l: string) => l.trim() && l.includes("/")).length
  if (noSuidMounts > 3) {
    findings.push({
      checkId: "LNX-MOUNTS-003",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "filesystem",
      title: `${noSuidMounts} mount(s) without nosuid option`,
      details: `${noSuidMounts} filesystem mount(s) allow SUID execution — SUID binaries on these mounts can escalate privileges`,
      remediation: "Add nosuid mount option to non-system partitions in /etc/fstab",
    })
  }

  if (r.stdout.includes("/dev/shm") && !r.stdout.includes("noexec")) {
    findings.push({
      checkId: "LNX-MOUNTS-004",
      provider: "linuxhook",
      severity: "LOW",
      status: "IDENTIFIED",
      resource: "/dev/shm",
      title: "/dev/shm mounted without noexec",
      details: "/dev/shm allows execution — attackers can stage and execute payloads from shared memory",
      remediation: "Mount /dev/shm with noexec,nosuid,nodev options",
    })
  }

  return { output: output.join("\n"), findings }
}
