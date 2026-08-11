import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function sshPivot(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const user = argVal(args, "--user") || "root"
  const key = argVal(args, "--key")
  const command = argVal(args, "--command")
  const tunnel = argVal(args, "--tunnel")
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Pivot ==="]

  const agent = await run("ssh-add", ["-l"], timeout)
  if (agent.exitCode === 0 && !agent.stdout.includes("no identities")) {
    output.push(`\n[+] SSH agent loaded keys:\n${agent.stdout.trim()}`)
  }
  if (agent.exitCode !== 0) {
    output.push("\n[*] SSH agent: no identities loaded")
  }

  if (!target) {
    output.push("\n[*] No --target specified — enumerating pivot targets\n")

    const home = process.env.HOME || "/root"
    const config = await run("cat", [`${home}/.ssh/config`], timeout)
    if (config.exitCode === 0 && config.stdout.trim()) {
      const hosts = config.stdout.match(/^Host\s+(.+)/gm) || []
      output.push(`[+] SSH config hosts (${hosts.length}):`)
      for (const h of hosts) output.push(`    ${h}`)
    }

    const knownHosts = await run("cat", [`${home}/.ssh/known_hosts`], timeout)
    if (knownHosts.exitCode === 0 && knownHosts.stdout.trim()) {
      const lines = knownHosts.stdout.split("\n").filter(Boolean)
      output.push(`\n[+] Known hosts (${lines.length}):`)
      for (const l of lines.slice(0, 30)) {
        const host = l.split(" ")[0]
        output.push(`    ${host}`)
      }
    }

    const keyFiles = await run("find", [`${home}/.ssh`, "-name", "id_*", "-not", "-name", "*.pub"], timeout)
    if (keyFiles.exitCode === 0 && keyFiles.stdout.trim()) {
      const keys = keyFiles.stdout.trim().split("\n").filter(Boolean)
      output.push(`\n[+] Available SSH keys (${keys.length}):`)
      for (const k of keys) output.push(`    ${k}`)
    }

    findings.push({
      checkId: "MAC-SSH-PIVOT-001",
      provider: "macos",
      severity: "high",
      status: "ENUMERATED",
      resource: "macos://ssh",
      title: "SSH pivot targets enumerated",
      details: "SSH config hosts, known_hosts, and available keys collected for lateral movement",
      remediation: "Restrict SSH key access and rotate keys after engagement",
    })

    return { output: output.join("\n"), findings }
  }

  if (tunnel) {
    const parts = tunnel.split(":")
    if (parts.length < 2) {
      output.push("[!] Invalid tunnel format. Use --tunnel LOCAL_PORT:REMOTE_PORT")
      return { output: output.join("\n"), findings }
    }
    const sshArgs = ["-o", "StrictHostKeyChecking=no", "-L", `${parts[0]}:localhost:${parts[1]}`, "-N", "-f"]
    if (key) sshArgs.push("-i", key)
    sshArgs.push(`${user}@${target}`)
    output.push(`\n[*] Creating SSH tunnel: localhost:${parts[0]} -> ${target}:${parts[1]}`)
    const tun = await run("ssh", sshArgs, timeout)
    if (tun.exitCode === 0) {
      output.push(`[+] Tunnel established: localhost:${parts[0]} -> ${target}:${parts[1]}`)
    }
    if (tun.exitCode !== 0) {
      output.push(`[!] Tunnel failed: ${tun.stderr.trim()}`)
    }
    findings.push({
      checkId: "MAC-SSH-PIVOT-002",
      provider: "macos",
      severity: "high",
      status: "EXPLOITED",
      resource: target,
      title: `SSH tunnel to ${target}`,
      details: `Tunnel: localhost:${parts[0]} -> ${target}:${parts[1]} as ${user}`,
      remediation: "Kill tunnel process and rotate SSH keys",
    })
    return { output: output.join("\n"), findings }
  }

  const sshArgs = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
  if (key) sshArgs.push("-i", key)
  sshArgs.push(`${user}@${target}`)
  if (command) sshArgs.push(command)

  output.push(`\n[*] Executing SSH ${command ? "command" : "connection test"}: ${user}@${target}`)
  const r = await run("ssh", sshArgs, timeout)
  if (r.exitCode === 0) {
    output.push(`[+] SSH success:\n${r.stdout.trim().substring(0, 2000)}`)
  }
  if (r.exitCode !== 0) {
    output.push(`[!] SSH failed: ${r.stderr.trim()}`)
  }

  findings.push({
    checkId: "MAC-SSH-PIVOT-003",
    provider: "macos",
    severity: "high",
    status: r.exitCode === 0 ? "EXPLOITED" : "ATTEMPTED",
    resource: target,
    title: `SSH pivot ${r.exitCode === 0 ? "successful" : "failed"}: ${user}@${target}`,
    details:
      r.exitCode === 0
        ? `Command executed on ${target} as ${user}`
        : `Connection failed: ${r.stderr.trim().substring(0, 200)}`,
    remediation: "Rotate SSH keys and restrict access after engagement",
  })

  return { output: output.join("\n"), findings }
}

export async function airdropAbuse(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== AirDrop Reconnaissance ==="]

  const discoverMode = await run("defaults", ["read", "com.apple.sharingd", "DiscoverableMode"], timeout)
  const mode = discoverMode.stdout.trim()
  const modeLabel =
    mode === "Off"
      ? "No One"
      : mode === "Contacts Only"
        ? "Contacts Only"
        : mode === "Everyone"
          ? "Everyone"
          : mode || "unknown"
  output.push(`\n[+] AirDrop discoverability: ${modeLabel}`)

  const awdl = await run("ifconfig", ["awdl0"], timeout)
  if (awdl.exitCode === 0) {
    const active = awdl.stdout.includes("status: active")
    output.push(`[+] AWDL0 interface: ${active ? "ACTIVE" : "inactive"}`)
    if (active) {
      output.push(`\n${awdl.stdout.trim()}`)
    }
  }
  if (awdl.exitCode !== 0) {
    output.push("[*] AWDL0 interface: not available")
  }

  output.push("\n[*] Scanning for nearby AirDrop devices (5s)...")
  const dnsSd = await run("dns-sd", ["-B", "_airdrop._tcp"], 5)
  const combined = dnsSd.stdout + "\n" + dnsSd.stderr
  const instances = combined.split("\n").filter((l) => l.includes("Add") && l.includes("_airdrop"))
  if (instances.length > 0) {
    output.push(`[+] Nearby AirDrop devices: ${instances.length}`)
    for (const inst of instances) output.push(`    ${inst.trim()}`)
  }
  if (instances.length === 0) {
    output.push("[*] No AirDrop devices discovered in scan window")
  }

  findings.push({
    checkId: "MAC-AIRDROP-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://airdrop",
    title: `AirDrop status: ${modeLabel}, ${instances.length} nearby devices`,
    details: `Discoverability: ${modeLabel}, AWDL0: ${awdl.exitCode === 0 ? "present" : "absent"}, ${instances.length} nearby device(s) found`,
    remediation: "Set AirDrop to 'Contacts Only' or 'No One' to reduce attack surface",
  })

  return { output: output.join("\n"), findings }
}

export async function bonjourEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Bonjour/mDNS Service Discovery ==="]

  const serviceTypes = [
    { type: "_ssh._tcp", label: "SSH" },
    { type: "_http._tcp", label: "HTTP" },
    { type: "_smb._tcp", label: "SMB" },
    { type: "_afpovertcp._tcp", label: "AFP" },
    { type: "_rfb._tcp", label: "VNC/Screen Sharing" },
    { type: "_printer._tcp", label: "Printer" },
  ]

  let totalServices = 0

  for (const svc of serviceTypes) {
    output.push(`\n--- ${svc.label} (${svc.type}) ---`)
    const r = await run("dns-sd", ["-B", svc.type], 5)
    const combined = r.stdout + "\n" + r.stderr
    const instances = combined.split("\n").filter((l) => l.includes("Add") && l.includes(svc.type))
    if (instances.length > 0) {
      output.push(`[+] Found ${instances.length} ${svc.label} service(s):`)
      for (const inst of instances) {
        const parts = inst.trim().split(/\s+/)
        const name = parts.slice(6).join(" ")
        output.push(`    ${name || inst.trim()}`)
      }
      totalServices += instances.length
    }
    if (instances.length === 0) {
      output.push(`[*] No ${svc.label} services found`)
    }
  }

  findings.push({
    checkId: "MAC-BONJOUR-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://bonjour",
    title: `Bonjour services discovered: ${totalServices} total`,
    details: `${totalServices} services found across ${serviceTypes.length} mDNS service types — potential lateral movement targets`,
    remediation: "Disable unnecessary Bonjour-advertised services. Segment network to limit mDNS visibility.",
  })

  return { output: output.join("\n"), findings }
}

export async function appleRemoteDesktop(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Apple Remote Desktop / Screen Sharing ==="]

  const ardProcs = await run("ps", ["aux"], timeout)
  const ardLines = ardProcs.stdout
    .split("\n")
    .filter((l) => l.includes("ARDAgent") || l.includes("RemoteManagement") || l.includes("screensharingd"))
  const ardRunning = ardLines.length > 0
  output.push(`\n[+] ARD/Screen Sharing processes: ${ardRunning ? "RUNNING" : "not found"}`)
  if (ardRunning) {
    for (const l of ardLines) output.push(`    ${l.trim()}`)
  }

  const ardSettings = await run("defaults", ["read", "/Library/Preferences/com.apple.RemoteManagement"], timeout)
  if (ardSettings.exitCode === 0) {
    output.push(`\n[+] Remote Management settings:\n${ardSettings.stdout.trim().substring(0, 1000)}`)
  }
  if (ardSettings.exitCode !== 0) {
    output.push("\n[*] Remote Management: not configured or no access")
  }

  const screenSharing = await run("defaults", ["read", "/Library/Preferences/com.apple.screensharing"], timeout)
  if (screenSharing.exitCode === 0) {
    output.push(`\n[+] Screen Sharing settings:\n${screenSharing.stdout.trim().substring(0, 500)}`)
  }

  const home = process.env.HOME || "/root"
  const userScreenSharing = await run(
    "defaults",
    ["read", `${home}/Library/Preferences/com.apple.ScreenSharing`],
    timeout,
  )
  if (userScreenSharing.exitCode === 0) {
    output.push(`\n[+] User Screen Sharing preferences:\n${userScreenSharing.stdout.trim().substring(0, 500)}`)
  }

  const ardGroup = await run("dscl", [".", "-read", "/Groups/com.apple.access_remote_ae", "GroupMembership"], timeout)
  const allUsersAccess = ardGroup.exitCode !== 0
  if (ardGroup.exitCode === 0) {
    output.push(`\n[+] Remote Apple Events access group:\n    ${ardGroup.stdout.trim()}`)
  }
  if (ardGroup.exitCode !== 0) {
    output.push("\n[*] Remote Apple Events group: not configured (may allow all users)")
  }

  const sshRemoteLogin = await run("systemsetup", ["-getremotelogin"], timeout)
  if (sshRemoteLogin.exitCode === 0) {
    output.push(`\n[+] Remote Login (SSH): ${sshRemoteLogin.stdout.trim()}`)
  }

  if (ardRunning) {
    findings.push({
      checkId: "MAC-ARD-001",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://ard",
      title: "Apple Remote Desktop / Screen Sharing is active",
      details: `ARD/screensharingd running — remote desktop access is available. ${ardSettings.exitCode === 0 ? "Configuration retrieved." : ""}`,
      remediation:
        "Disable ARD if not needed: sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -deactivate -stop",
    })
  }

  if (ardRunning && allUsersAccess) {
    findings.push({
      checkId: "MAC-ARD-002",
      provider: "macos",
      severity: "critical",
      status: "VULNERABLE",
      resource: "macos://ard",
      title: "Remote desktop may be accessible to all users",
      details: "ARD is running and no specific access group is configured — all users may have remote access",
      remediation: "Restrict remote access to specific users via System Preferences > Sharing",
    })
  }

  if (!ardRunning) {
    output.push("\n[*] ARD/Screen Sharing not active — no remote desktop attack surface")
  }

  return { output: output.join("\n"), findings }
}
