---
name: "T1070.007_clear-network-connection-history-and-configurations"
description: "Adversaries may clear or remove evidence of malicious network connections in order to clean up traces of their operations."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.007
  - defense-evasion
  - linux
  - macos
  - windows
  - network-devices
  - sub-technique
technique_id: "T1070.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1070/007"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
---

# T1070.007 Clear Network Connection History and Configurations

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may clear or remove evidence of malicious network connections in order to clean up traces of their operations. Configuration settings as well as various artifacts that highlight connection history may be created on a system and/or in application logs from behaviors that require network connections, such as Remote Services or External Remote Services. Defenders may use these artifacts to monitor or otherwise analyze network connections created by adversaries.

Network connection history may be stored in various locations. For example, RDP connection history may be stored in Windows Registry values under :

* <code>HKEY_CURRENT_USER\Software\Microsoft\Terminal Server Client\Default</code>
* <code>HKEY_CURRENT_USER\Software\Microsoft\Terminal Server Client\Servers</code>

Windows may also store information about recent RDP connections in files such as <code>C:\Users\\%username%\Documents\Default.rdp</code> and `C:\Users\%username%\AppData\Local\Microsoft\Terminal
Server Client\Cache\`. Similarly, macOS and Linux hosts may store information highlighting connection history in system logs (such as those stored in `/Library/Logs` and/or `/var/log/`).

Malicious network connections may also require changes to third-party applications or network configuration settings, such as Disable or Modify System Firewall or tampering to enable Proxy. Adversaries may delete or modify this data to conceal indicators and/or impede defensive analysis.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows, Network Devices

## What to Check

- [ ] Identify if Clear Network Connection History and Configurations technique is applicable to target environment
- [ ] Check Linux systems for indicators of Clear Network Connection History and Configurations
- [ ] Check macOS systems for indicators of Clear Network Connection History and Configurations
- [ ] Check Windows systems for indicators of Clear Network Connection History and Configurations
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clear Network Connection History and Configurations by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1029 Remote Data Storage
Automatically forward events to a log server or data repository to prevent conditions in which the adversary can locate and manipulate data on the local system. When possible, minimize time delay on event reporting to avoid prolonged storage on the local system.

### M1024 Restrict Registry Permissions
Protect generated event files and logs that are stored locally with proper permissions and authentication and limit opportunities for adversaries to increase privileges by preventing Privilege Escalation opportunities.


## Detection

### Behavioral Detection of Network History and Configuration Tampering


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Clear Network Connection History and Configurations technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [FreeDesktop Journal](https://www.freedesktop.org/software/systemd/man/systemd-journald.service.html)
- [Microsoft RDP Removal](https://docs.microsoft.com/troubleshoot/windows-server/remote/remove-entries-from-remote-desktop-connection-computer)
- [Moran RDPieces](https://www.osdfcon.org/presentations/2020/Brian-Moran_Putting-Together-the-RDPieces.pdf)
- [Apple Culprit Access](https://discussions.apple.com/thread/3991574)
- [Apple Unified Log Analysis Remote Login and Screen Sharing](https://sarah-edwards-xzkc.squarespace.com/blog/2020/4/30/analysis-of-apple-unified-logs-quarantine-edition-entry-6-working-from-home-remote-logins)
- [Atomic Red Team - T1070.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.007)
- [MITRE ATT&CK - T1070.007](https://attack.mitre.org/techniques/T1070/007)
