---
name: "T1070.005_network-share-connection-removal"
description: "Adversaries may remove share connections that are no longer useful in order to clean up traces of their operation."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.005
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1070.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1070/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.006
  - T1070.007
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

# T1070.005 Network Share Connection Removal

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may remove share connections that are no longer useful in order to clean up traces of their operation. Windows shared drive and SMB/Windows Admin Shares connections can be removed when no longer needed. Net is an example utility that can be used to remove network share connections with the <code>net use \\system\share /delete</code> command.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Network Share Connection Removal technique is applicable to target environment
- [ ] Check Windows systems for indicators of Network Share Connection Removal
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Add Network Share

Add a Network Share utilizing the command_prompt

**Supported Platforms:** windows

```cmd
net use c: #{share_name}
net share test=#{share_name} /REMARK:"test share" /CACHE:No
```

### Atomic Test 2: Remove Network Share

Removes a Network Share utilizing the command_prompt

**Supported Platforms:** windows

```cmd
net share #{share_name} /delete
```

### Atomic Test 3: Remove Network Share PowerShell

Removes a Network Share utilizing PowerShell

**Supported Platforms:** windows

```powershell
Remove-SmbShare -Name #{share_name}
Remove-FileShare -Name #{share_name}
```

### Atomic Test 4: Disable Administrative Share Creation at Startup

Administrative shares are hidden network shares created by Microsoft’s Windows NT operating systems that grant system administrators
remote access to every disk volume on a network-connected system. These shares are automatically created at started unless they have been
purposefully disabled as is done in this Atomic test. As Microsoft puts it, "Missing administrative shares typically
indicate that the computer in question has been compromised by malicious software."
https://threatpost.com/conti-ransomware-gang-has-full-log4shell-attack-chain/177173/

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters" /v AutoShareServer /t REG_DWORD /d 0 /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters" /v AutoShareWks /t REG_DWORD /d 0 /f
```

### Atomic Test 5: Remove Administrative Shares

Administrative shares are hidden network shares created by Microsoft’s Windows NT operating systems that grant system administrators
remote access to every disk volume on a network-connected system. As Microsoft puts it, “Missing administrative shares typically
indicate that the computer in question has been compromised by malicious software.
https://threatpost.com/conti-ransomware-gang-has-full-log4shell-attack-chain/177173/

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
for %i in (C$ IPC$ ADMIN$) do net share %i /delete
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Share Connection Removal by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Network Share Connection Removal via CLI and SMB Disconnects

## Risk Assessment

| Finding                                               | Severity | Impact          |
| ----------------------------------------------------- | -------- | --------------- |
| Network Share Connection Removal technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Technet Net Use](https://technet.microsoft.com/bb490717.aspx)
- [Atomic Red Team - T1070.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.005)
- [MITRE ATT&CK - T1070.005](https://attack.mitre.org/techniques/T1070/005)
