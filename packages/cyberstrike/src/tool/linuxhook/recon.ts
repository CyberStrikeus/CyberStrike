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
