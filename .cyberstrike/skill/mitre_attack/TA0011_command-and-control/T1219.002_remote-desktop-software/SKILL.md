---
name: "T1219.002_remote-desktop-software"
description: "An adversary may use legitimate desktop support software to establish an interactive command and control channel to target systems within networks."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1219.002
  - command-and-control
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1219.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1219/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1219
  - T1219.001
  - T1219.003
prerequisites:
  - T1219
severity_boost:
  T1219: "Chain with T1219 for deeper attack path"
  T1219.001: "Chain with T1219.001 for deeper attack path"
  T1219.003: "Chain with T1219.003 for deeper attack path"
---

# T1219.002 Remote Desktop Software

> **Sub-technique of:** T1219

## High-Level Description

An adversary may use legitimate desktop support software to establish an interactive command and control channel to target systems within networks. Desktop support software provides a graphical interface for remotely controlling another computer, transmitting the display output, keyboard input, and mouse control between devices using various protocols. Desktop support software, such as `VNC`, `Team Viewer`, `AnyDesk`, `ScreenConnect`, `LogMein`, `AmmyyAdmin`, and other remote monitoring and management (RMM) tools, are commonly used as legitimate technical support software and may be allowed by application control within a target environment.

Remote access modules/features may also exist as part of otherwise existing software such as Zoom or Google Chrome’s Remote Desktop.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Remote Desktop Software technique is applicable to target environment
- [ ] Check Linux systems for indicators of Remote Desktop Software
- [ ] Check macOS systems for indicators of Remote Desktop Software
- [ ] Check Windows systems for indicators of Remote Desktop Software
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Desktop Software by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1219.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling unnecessary remote connection functionality, including both unapproved software installations and specific features built into supported applications.

### M1037 Filter Network Traffic

Properly configure firewalls, application firewalls, and proxies to limit outgoing traffic to sites and services used by remote access software.

### M1038 Execution Prevention

Use application control to mitigate installation and use of unapproved software that can be used for remote access.

## Detection

### Remote Desktop Software Execution and Beaconing Detection

## Risk Assessment

| Finding                                      | Severity | Impact              |
| -------------------------------------------- | -------- | ------------------- |
| Remote Desktop Software technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [CrowdStrike 2015 Global Threat Report](https://go.crowdstrike.com/rs/281-OBQ-266/images/15GlobalThreatReport.pdf)
- [CrySyS Blog TeamSpy](https://blog.crysys.hu/2013/03/teamspy/)
- [Google Chrome Remote Desktop](https://support.google.com/chrome/answer/1649523)
- [Chrome Remote Desktop](https://www.huntress.com/blog/slashandgrab-screen-connect-post-exploitation-in-the-wild-cve-2024-1709-cve-2024-1708)
- [Symantec Living off the Land](https://www.symantec.com/content/dam/symantec/docs/security-center/white-papers/istr-living-off-the-land-and-fileless-attack-techniques-en.pdf)
- [Atomic Red Team - T1219.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1219.002)
- [MITRE ATT&CK - T1219.002](https://attack.mitre.org/techniques/T1219/002)
