---
name: "T1135_network-share-discovery"
description: "Adversaries may look for folders and drives shared on remote systems as a means of identifying sources of information to gather as a precursor for Collection and to identify potential systems of in..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1135
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1135"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1135"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1135 Network Share Discovery

## High-Level Description

Adversaries may look for folders and drives shared on remote systems as a means of identifying sources of information to gather as a precursor for Collection and to identify potential systems of interest for Lateral Movement. Networks often contain shared network drives and folders that enable users to access file directories on various systems across a network.

File sharing over a Windows network occurs over the SMB protocol. Net can be used to query a remote system for available shared drives using the <code>net view \\\\remotesystem</code> command. It can also be used to query shared drives on the local system using <code>net share</code>. For macOS, the <code>sharing -l</code> command lists all shared points used for smb services.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Network Share Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Network Share Discovery
- [ ] Check macOS systems for indicators of Network Share Discovery
- [ ] Check Windows systems for indicators of Network Share Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Network Share Discovery

Network Share Discovery

**Supported Platforms:** macos

```bash
df -aH
smbutil view -g //#{computer_name}
showmount #{computer_name}
```

### Atomic Test 2: Network Share Discovery - linux

Network Share Discovery using smbstatus

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
smbstatus --shares
```

**Dependencies:**

- Package with smbstatus (samba) must exist on device

### Atomic Test 3: Network Share Discovery - FreeBSD

Network Share Discovery using smbstatus

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
smbstatus --shares
```

**Dependencies:**

- Package with smbstatus (samba) must exist on device

### Atomic Test 4: Network Share Discovery command prompt

Network Share Discovery utilizing the command prompt. The computer name variable may need to be modified to point to a different host
Upon execution available network shares will be displayed in the powershell session

**Supported Platforms:** windows

```cmd
net view \\#{computer_name}
```

### Atomic Test 5: Network Share Discovery PowerShell

Network Share Discovery utilizing PowerShell. The computer name variable may need to be modified to point to a different host
Upon execution, available network shares will be displayed in the powershell session

**Supported Platforms:** windows

```powershell
get-smbshare
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Share Discovery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1135 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

Enable Windows Group Policy “Do Not Allow Anonymous Enumeration of SAM Accounts and Shares” security setting to limit users who can enumerate network shares.

## Detection

### Behavior-chain detection for T1135 Network Share Discovery across Windows, Linux, and macOS

## Risk Assessment

| Finding                                      | Severity | Impact    |
| -------------------------------------------- | -------- | --------- |
| Network Share Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [TechNet Shared Folder](https://technet.microsoft.com/library/cc770880.aspx)
- [Wikipedia Shared Resource](https://en.wikipedia.org/wiki/Shared_resource)
- [Atomic Red Team - T1135](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1135)
- [MITRE ATT&CK - T1135](https://attack.mitre.org/techniques/T1135)
