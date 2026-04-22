---
name: "T1518.001_security-software-discovery"
description: "Adversaries may attempt to get a listing of security software, configurations, defensive tools, and sensors that are installed on a system or in a cloud environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1518.001
  - discovery
  - iaas
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1518.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1518/001"
tech_stack:
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1518
  - T1518.002
prerequisites:
  - T1518
severity_boost:
  T1518: "Chain with T1518 for deeper attack path"
  T1518.002: "Chain with T1518.002 for deeper attack path"
---

# T1518.001 Security Software Discovery

> **Sub-technique of:** T1518

## High-Level Description

Adversaries may attempt to get a listing of security software, configurations, defensive tools, and sensors that are installed on a system or in a cloud environment. This may include things such as cloud monitoring agents and anti-virus. Adversaries may use the information from Security Software Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

Example commands that can be used to obtain security software information are netsh, <code>reg query</code> with Reg, <code>dir</code> with cmd, and Tasklist, but other indicators of discovery behavior may be more specific to the type of software or security system the adversary is looking for. It is becoming more common to see macOS malware perform checks for LittleSnitch and KnockKnock software.

Adversaries may also utilize the Cloud API to discover cloud-native security software installed on compute infrastructure, such as the AWS CloudWatch agent, Azure VM Agent, and Google Cloud Monitor agent. These agents may collect metrics and logs from the VM, which may be centrally aggregated in a cloud-based monitoring platform.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Security Software Discovery technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Security Software Discovery
- [ ] Check Linux systems for indicators of Security Software Discovery
- [ ] Check macOS systems for indicators of Security Software Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Security Software Discovery

Methods to identify Security Software on an endpoint

when sucessfully executed, the test is going to display running processes, firewall configuration on network profiles
and specific security software.

**Supported Platforms:** windows

```cmd
netsh.exe advfirewall  show allprofiles
netsh.exe advfirewall firewall dump
netsh.exe advfirewall show currentprofile
netsh.exe advfirewall firewall show rule name=all
netsh.exe firewall show state
netsh.exe firewall show config
sc query windefend
powershell.exe /c "Get-Process | Where-Object { $_.ProcessName -eq 'Sysmon' }"
powershell.exe /c "Get-Service | where-object {$_.DisplayName -like '*sysm*'}"
powershell.exe /c "Get-CimInstance Win32_Service -Filter 'Description = ''System Monitor service'''"
tasklist.exe
tasklist.exe | findstr /i virus
tasklist.exe | findstr /i cb
tasklist.exe | findstr /i defender
tasklist.exe | findstr /i cylance
tasklist.exe | findstr /i mc
tasklist.exe | findstr /i "virus cb defender cylance mc"
```

### Atomic Test 2: Security Software Discovery - powershell

Methods to identify Security Software on an endpoint

when sucessfully executed, powershell is going to processes related AV products if they are running.
Note that, depending on the privilege of current user, get-process | ?{$_.Description -like "*"} may not return the processes related to AV products of the check.
For instance, only with Administrator right, you can see the process description of McAffee processes. Hence, it is better to use get-process | ?{$\_.ProcessName -like "\*"},
if you know the name of those processes.

**Supported Platforms:** windows

```powershell
get-process | ?{$_.Description -like "*virus*"}
get-process | ?{$_.Description -like "*carbonblack*"}
get-process | ?{$_.Description -like "*defender*"}
get-process | ?{$_.Description -like "*cylance*"}
get-process | ?{$_.Description -like "*mc*"}
get-process | ?{$_.ProcessName -like "*mc*"}
get-process | Where-Object { $_.ProcessName -eq "Sysmon" }
```

### Atomic Test 3: Security Software Discovery - ps (macOS)

Methods to identify Security Software on an endpoint
when sucessfully executed, command shell is going to display AV/Security software it is running.

**Supported Platforms:** macos

```bash
ps aux | egrep 'Little\ Snitch|CbOsxSensorService|falcond|nessusd|santad|CbDefense|td-agent|packetbeat|filebeat|auditbeat|osqueryd|BlockBlock|LuLu'
```

### Atomic Test 4: Security Software Discovery - ps (Linux)

Methods to identify Security Software on an endpoint
when sucessfully executed, command shell is going to display AV/Security software it is running.

**Supported Platforms:** linux

```bash
ps aux | egrep 'falcond|nessusd|cbagentd|td-agent|packetbeat|filebeat|auditbeat|osqueryd'
```

### Atomic Test 5: Security Software Discovery - pgrep (FreeBSD)

Methods to identify Security Software on an endpoint
when sucessfully executed, command shell is going to display AV/Security software it is running.

**Supported Platforms:** linux

```bash
pgrep -l 'bareos-fd|icinga2|cbagentd|wazuh-agent|packetbeat|filebeat|osqueryd'
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Security Software Discovery by examining the target platforms (IaaS, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1518.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Security Software Discovery Across Platforms

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| Security Software Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1518.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1518.001)
- [MITRE ATT&CK - T1518.001](https://attack.mitre.org/techniques/T1518/001)
