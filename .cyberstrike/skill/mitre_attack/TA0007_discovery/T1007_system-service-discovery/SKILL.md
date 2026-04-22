---
name: "T1007_system-service-discovery"
description: "Adversaries may try to gather information about registered local system services."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1007
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1007"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1007"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1007 System Service Discovery

## High-Level Description

Adversaries may try to gather information about registered local system services. Adversaries may obtain information about services using tools as well as OS utility commands such as <code>sc query</code>, <code>tasklist /svc</code>, <code>systemctl --type=service</code>, and <code>net start</code>. Adversaries may also gather information about schedule tasks via commands such as `schtasks` on Windows or `crontab -l` on Linux and macOS.

Adversaries may use the information from System Service Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if System Service Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of System Service Discovery
- [ ] Check macOS systems for indicators of System Service Discovery
- [ ] Check Windows systems for indicators of System Service Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System Service Discovery

Identify system services.

Upon successful execution, cmd.exe will execute service commands with expected result to stdout.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
tasklist.exe /svc
sc query
sc query state= all
```

### Atomic Test 2: System Service Discovery - net.exe

Enumerates started system services using net.exe and writes them to a file. This technique has been used by multiple threat actors.

Upon successful execution, net.exe will run from cmd.exe that queries services. Expected output is to a txt file in in the temp directory called service-list.txt.

**Supported Platforms:** windows

```cmd
net.exe start >> #{output_file}
```

### Atomic Test 3: System Service Discovery - systemctl/service

Enumerates system service using systemctl/service

**Supported Platforms:** linux

```bash
if [ "$(uname)" = 'FreeBSD' ]; then service -e; else systemctl --type=service; fi;
```

### Atomic Test 4: Get-Service Execution

Executes the Get-Service cmdlet to gather objects representing all services on the local system.

**Supported Platforms:** windows

```cmd
powershell.exe Get-Service
```

### Atomic Test 5: System Service Discovery - macOS launchctl

Enumerates services on macOS using launchctl. Used by adversaries for
identifying daemons, background services, and persistence mechanisms.

**Supported Platforms:** macos

```bash
launchctl list
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Service Discovery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of System Service Discovery Commands Across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Service Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Aquasec Kinsing 2020](https://www.aquasec.com/blog/threat-alert-kinsing-malware-container-vulnerability/)
- [Elastic Security Labs GOSAR 2024](https://www.elastic.co/security-labs/under-the-sadbridge-with-gosar)
- [SentinelLabs macOS Malware 2021](https://www.sentinelone.com/labs/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Splunk Linux Gormir 2024](https://www.splunk.com/en_us/blog/security/breaking-down-linux-gomir-understanding-this-backdoors-ttps.html)
- [Atomic Red Team - T1007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1007)
- [MITRE ATT&CK - T1007](https://attack.mitre.org/techniques/T1007)
