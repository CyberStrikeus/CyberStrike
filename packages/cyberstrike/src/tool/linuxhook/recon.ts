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
