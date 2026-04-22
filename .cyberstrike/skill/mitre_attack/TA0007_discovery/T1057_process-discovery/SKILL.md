---
name: "T1057_process-discovery"
description: "Adversaries may attempt to get information about running processes on a system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1057
  - discovery
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1057"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1057"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1057 Process Discovery

## High-Level Description

Adversaries may attempt to get information about running processes on a system. Information obtained could be used to gain an understanding of common software/applications running on systems within the network. Administrator or otherwise elevated access may provide better process details. Adversaries may use the information from Process Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

In Windows environments, adversaries could obtain details on running processes using the Tasklist utility via cmd or <code>Get-Process</code> via PowerShell. Information about processes can also be extracted from the output of Native API calls such as <code>CreateToolhelp32Snapshot</code>. In Mac and Linux, this is accomplished with the <code>ps</code> command. Adversaries may also opt to enumerate processes via `/proc`. ESXi also supports use of the `ps` command, as well as `esxcli system process list`.

On network devices, Network Device CLI commands such as `show processes` can be used to display current running processes.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Process Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Process Discovery
- [ ] Check Linux systems for indicators of Process Discovery
- [ ] Check macOS systems for indicators of Process Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process Discovery - ps

Utilize ps to identify processes.

Upon successful execution, sh will execute ps and output to /tmp/loot.txt.

**Supported Platforms:** linux, macos

```bash
ps >> #{output_file}
ps aux >> #{output_file}
```

### Atomic Test 2: Process Discovery - tasklist

Utilize tasklist to identify processes.

Upon successful execution, cmd.exe will execute tasklist.exe to list processes. Output will be via stdout.

**Supported Platforms:** windows

```cmd
tasklist
```

### Atomic Test 3: Process Discovery - Get-Process

Utilize Get-Process PowerShell cmdlet to identify processes.

Upon successful execution, powershell.exe will execute Get-Process to list processes. Output will be via stdout.

**Supported Platforms:** windows

```powershell
Get-Process
```

### Atomic Test 4: Process Discovery - get-wmiObject

Utilize get-wmiObject PowerShell cmdlet to identify processes.

Upon successful execution, powershell.exe will execute get-wmiObject to list processes. Output will be via stdout.

**Supported Platforms:** windows

```powershell
get-wmiObject -class Win32_Process
```

### Atomic Test 5: Process Discovery - wmic process

Utilize windows management instrumentation to identify processes.

Upon successful execution, WMIC will execute process to list processes. Output will be via stdout.

**Supported Platforms:** windows

```cmd
wmic process get /format:list
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Process Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1057 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Adversarial Process Discovery Behavior


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Process Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [show_processes_cisco_cmd](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_monitor_permit_list_through_show_process_memory.html#wp3599497760)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Sygnia ESXi Ransomware 2025](https://www.sygnia.co/blog/esxi-ransomware-ssh-tunneling-defense-strategies/)
- [Atomic Red Team - T1057](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1057)
- [MITRE ATT&CK - T1057](https://attack.mitre.org/techniques/T1057)
