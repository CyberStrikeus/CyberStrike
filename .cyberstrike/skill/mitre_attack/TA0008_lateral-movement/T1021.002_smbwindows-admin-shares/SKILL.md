---
name: "T1021.002_smbwindows-admin-shares"
description: "Adversaries may use Valid Accounts to interact with a remote network share using Server Message Block (SMB)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.002
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1021.002"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1021/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.003
  - T1021.004
  - T1021.005
  - T1021.006
  - T1021.007
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.003: "Chain with T1021.003 for deeper attack path"
---

# T1021.002 SMB/Windows Admin Shares

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to interact with a remote network share using Server Message Block (SMB). The adversary may then perform actions as the logged-on user.

SMB is a file, printer, and serial port sharing protocol for Windows machines on the same network or domain. Adversaries may use SMB to interact with file shares, allowing them to move laterally throughout a network. Linux and macOS implementations of SMB typically use Samba.

Windows systems have hidden network shares that are accessible only to administrators and provide the ability for remote file copy and other administrative functions. Example network shares include `C$`, `ADMIN$`, and `IPC$`. Adversaries may use this technique in conjunction with administrator-level Valid Accounts to remotely access a networked system over SMB, to interact with systems using remote procedure calls (RPCs), transfer files, and run transferred binaries through remote Execution. Example execution techniques that rely on authenticated sessions over SMB/RPC are Scheduled Task/Job, Service Execution, and Windows Management Instrumentation. Adversaries can also use NTLM hashes to access administrator shares on systems with Pass the Hash and certain configuration and patch levels.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if SMB/Windows Admin Shares technique is applicable to target environment
- [ ] Check Windows systems for indicators of SMB/Windows Admin Shares
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Map admin share

Connecting To Remote Shares

**Supported Platforms:** windows

```cmd
cmd.exe /c "net use \\#{computer_name}\#{share_name} #{password} /u:#{user_name}"
```

### Atomic Test 2: Map Admin Share PowerShell

Map Admin share utilizing PowerShell

**Supported Platforms:** windows

```powershell
New-PSDrive -name #{map_name} -psprovider filesystem -root \\#{computer_name}\#{share_name}
```

### Atomic Test 3: Copy and Execute File with PsExec

Copies a file to a remote host and executes it using PsExec. Requires the download of PsExec from [https://docs.microsoft.com/en-us/sysinternals/downloads/psexec](https://docs.microsoft.com/en-us/sysinternals/downloads/psexec).

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{psexec_exe}" #{remote_host} -accepteula -c #{command_path}
```

**Dependencies:**

- PsExec tool from Sysinternals must exist on disk at specified location (#{psexec_exe})

### Atomic Test 4: Execute command writing output to local Admin Share

Executes a command, writing the output to a local Admin Share.
This technique is used by post-exploitation frameworks.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
cmd.exe /Q /c #{command_to_execute} 1> \\127.0.0.1\ADMIN$\#{output_file} 2>&1
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SMB/Windows Admin Shares by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Deny remote use of local admin credentials to log into systems. Do not allow domain user accounts to be in the local Administrators group multiple systems.

### M1035 Limit Access to Resource Over Network

Consider disabling Windows administrative shares.

### M1037 Filter Network Traffic

Consider using the host firewall to restrict file sharing communications such as SMB.

### M1027 Password Policies

Do not reuse local administrator account passwords across systems. Ensure password complexity and uniqueness such that the passwords cannot be cracked or guessed.

## Detection

### Multi-Event Detection for SMB Admin Share Lateral Movement

## Risk Assessment

| Finding                                       | Severity | Impact           |
| --------------------------------------------- | -------- | ---------------- |
| SMB/Windows Admin Shares technique applicable | Low      | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Medium Detecting WMI Persistence](https://medium.com/threatpunter/detecting-removing-wmi-persistence-60ccbb7dff96)
- [TechNet RPC](https://technet.microsoft.com/en-us/library/cc787851.aspx)
- [Microsoft Admin Shares](http://support.microsoft.com/kb/314984)
- [Windows Event Forwarding Payne](https://docs.microsoft.com/en-us/archive/blogs/jepayne/monitoring-what-matters-windows-event-forwarding-for-everyone-even-if-you-already-have-a-siem)
- [Lateral Movement Payne](https://docs.microsoft.com/en-us/archive/blogs/jepayne/tracking-lateral-movement-part-one-special-groups-and-specific-service-accounts)
- [Wikipedia Server Message Block](https://en.wikipedia.org/wiki/Server_Message_Block)
- [Atomic Red Team - T1021.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.002)
- [MITRE ATT&CK - T1021.002](https://attack.mitre.org/techniques/T1021/002)
