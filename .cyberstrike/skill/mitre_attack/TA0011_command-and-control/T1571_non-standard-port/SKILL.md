---
name: "T1571_non-standard-port"
description: "Adversaries may communicate using a protocol and port pairing that are typically not associated."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1571
  - command-and-control
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1571"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1571"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1571 Non-Standard Port

## High-Level Description

Adversaries may communicate using a protocol and port pairing that are typically not associated. For example, HTTPS over port 8088 or port 587 as opposed to the traditional port 443. Adversaries may make changes to the standard port used by a protocol to bypass filtering or muddle analysis/parsing of network data.

Adversaries may also make changes to victim systems to abuse non-standard ports. For example, Registry keys and other configuration settings can be used to modify protocol and port pairings.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Non-Standard Port technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Non-Standard Port
- [ ] Check Linux systems for indicators of Non-Standard Port
- [ ] Check macOS systems for indicators of Non-Standard Port
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Testing usage of uncommonly used port with PowerShell

Testing uncommonly used port utilizing PowerShell. APT33 has been known to attempt telnet over port 8081. Upon execution, details about the successful
port check will be displayed.

**Supported Platforms:** windows

```powershell
Test-NetConnection -ComputerName #{domain} -port #{port}
```

### Atomic Test 2: Testing usage of uncommonly used port

Testing uncommonly used port utilizing telnet.

**Supported Platforms:** linux, macos

```bash
echo quit | telnet #{domain} #{port}
exit 0
```

**Dependencies:**

- Requires telnet

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Non-Standard Port by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1571 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1030 Network Segmentation

Properly configure firewalls and proxies to limit outgoing traffic to only necessary ports for that particular network segment.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

## Detection

### Detection Strategy for Non-Standard Ports

## Risk Assessment

| Finding                                | Severity | Impact              |
| -------------------------------------- | -------- | ------------------- |
| Non-Standard Port technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Symantec Elfin Mar 2019](https://www.symantec.com/blogs/threat-intelligence/elfin-apt33-espionage)
- [change_rdp_port_conti](https://x.com/TheDFIRReport/status/1498657772254240768)
- [Fortinet Agent Tesla April 2018](https://www.fortinet.com/blog/threat-research/analysis-of-new-agent-tesla-spyware-variant.html)
- [Atomic Red Team - T1571](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1571)
- [MITRE ATT&CK - T1571](https://attack.mitre.org/techniques/T1571)
