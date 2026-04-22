---
name: "T1016.001_internet-connection-discovery"
description: "Adversaries may check for Internet connectivity on compromised systems."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1016.001
  - discovery
  - windows
  - linux
  - macos
  - esxi
  - sub-technique
technique_id: "T1016.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
  - Linux
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1016/001"
tech_stack:
  - windows
  - linux
  - macos
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1016
  - T1016.002
prerequisites:
  - T1016
severity_boost:
  T1016: "Chain with T1016 for deeper attack path"
  T1016.002: "Chain with T1016.002 for deeper attack path"
---

# T1016.001 Internet Connection Discovery

> **Sub-technique of:** T1016

## High-Level Description

Adversaries may check for Internet connectivity on compromised systems. This may be performed during automated discovery and can be accomplished in numerous ways such as using Ping, <code>tracert</code>, and GET requests to websites, or performing initial speed testing to confirm bandwidth.

Adversaries may use the results and responses from these requests to determine if the system is capable of communicating with their C2 servers before attempting to connect to them. The results may also be used to identify routes, redirectors, and proxy servers.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows, Linux, macOS, ESXi

## What to Check

- [ ] Identify if Internet Connection Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of Internet Connection Discovery
- [ ] Check Linux systems for indicators of Internet Connection Discovery
- [ ] Check macOS systems for indicators of Internet Connection Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Check internet connection using ping Windows

Check internet connection using ping on Windows. The default target of the ping is 8.8.8.8 (Google Public DNS).

**Supported Platforms:** windows

```cmd
ping -n 4 #{ping_target}
```

### Atomic Test 2: Check internet connection using ping freebsd, linux or macos

Check internet connection using ping on Linux, MACOS. The default target of the ping is 8.8.8.8 (Google Public DNS).

**Supported Platforms:** macos, linux

```bash
ping -c 4 #{ping_target}
```

### Atomic Test 3: Check internet connection using Test-NetConnection in PowerShell (ICMP-Ping)

Check internet connection using PowerShell's Test-NetConnection cmdlet and the ICMP/Ping protocol. The default target is 8.8.8.8 (Google Public DNS).

**Supported Platforms:** windows

```powershell
Test-NetConnection -ComputerName #{target}
```

### Atomic Test 4: Check internet connection using Test-NetConnection in PowerShell (TCP-HTTP)

Check internet connection using PowerShell's Test-NetConnection cmdlet and the TCP protocol to check for outbound HTTP (Port 80) access. The default target is www.google.com.

**Supported Platforms:** windows

```powershell
Test-NetConnection -CommonTCPPort HTTP -ComputerName #{target}
```

### Atomic Test 5: Check internet connection using Test-NetConnection in PowerShell (TCP-SMB)

Check internet connection using PowerShell's Test-NetConnection cmdlet and the TCP protocol to check for outbound SMB (Port 445) access. The default target is 8.8.8.8.

**Supported Platforms:** windows

```powershell
Test-NetConnection -CommonTCPPort SMB -ComputerName #{target}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Internet Connection Discovery by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1016.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Internet Connection Discovery

## Risk Assessment

| Finding                                            | Severity | Impact    |
| -------------------------------------------------- | -------- | --------- |
| Internet Connection Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1016.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1016.001)
- [MITRE ATT&CK - T1016.001](https://attack.mitre.org/techniques/T1016/001)
