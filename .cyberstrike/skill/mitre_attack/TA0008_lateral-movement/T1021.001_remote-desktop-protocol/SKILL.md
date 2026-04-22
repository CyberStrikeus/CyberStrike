---
name: "T1021.001_remote-desktop-protocol"
description: "Adversaries may use Valid Accounts to log into a computer using the Remote Desktop Protocol (RDP)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.001
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1021.001"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1021/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.002
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
  T1021.002: "Chain with T1021.002 for deeper attack path"
  T1021.003: "Chain with T1021.003 for deeper attack path"
---

# T1021.001 Remote Desktop Protocol

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to log into a computer using the Remote Desktop Protocol (RDP). The adversary may then perform actions as the logged-on user.

Remote desktop is a common feature in operating systems. It allows a user to log into an interactive session with a system desktop graphical user interface on a remote system. Microsoft refers to its implementation of the Remote Desktop Protocol (RDP) as Remote Desktop Services (RDS).

Adversaries may connect to a remote system over RDP/RDS to expand access if the service is enabled and allows access to accounts with known credentials. Adversaries will likely use Credential Access techniques to acquire credentials to use with RDP. Adversaries may also use RDP in conjunction with the Accessibility Features or Terminal Services DLL for Persistence.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if Remote Desktop Protocol technique is applicable to target environment
- [ ] Check Windows systems for indicators of Remote Desktop Protocol
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: RDP to DomainController

Attempt an RDP session via Remote Desktop Application to a DomainController.

**Supported Platforms:** windows

```powershell
$Server=#{logonserver}
$User = Join-Path #{domain} #{username}
$Password="#{password}"
cmdkey /generic:TERMSRV/$Server /user:$User /pass:$Password
mstsc /v:$Server
echo "RDP connection established"
```

**Dependencies:**

- Computer must be domain joined

### Atomic Test 2: Changing RDP Port to Non Standard Port via Powershell

Changing RDP Port to Non Standard Port via Powershell

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -name "PortNumber" -Value #{NEW_Remote_Port}
New-NetFirewallRule -DisplayName 'RDPPORTLatest-TCP-In' -Profile 'Public' -Direction Inbound -Action Allow -Protocol TCP -LocalPort #{NEW_Remote_Port}
```

### Atomic Test 3: Changing RDP Port to Non Standard Port via Command_Prompt

Changing RDP Port to Non Standard Port via Command_Prompt

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" /v PortNumber /t REG_DWORD /d #{NEW_Remote_Port} /f
netsh advfirewall firewall add rule name="RDPPORTLatest-TCP-In" dir=in action=allow protocol=TCP localport=#{NEW_Remote_Port}
```

### Atomic Test 4: Disable NLA for RDP via Command Prompt

Disables network-level authentication (NLA) for RDP by changing a registry key via Command Prompt
Disabling NLA for RDP can allow remote user interaction with the Windows sign-in screen prior to authentication. According to Microsoft, Flax Typhoon actors used this technique implementation to achieve persistence on victim systems: https://www.microsoft.com/en-us/security/blog/2023/08/24/flax-typhoon-using-legitimate-software-to-quietly-access-taiwanese-organizations/
See also: https://github.com/EmpireProject/Empire/blob/master/lib/modules/powershell/management/enable_rdp.py

**Supported Platforms:** windows

```cmd
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" /v UserAuthentication /d 0 /t REG_DWORD /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Desktop Protocol by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Audit the Remote Desktop Users group membership regularly. Remove unnecessary accounts and groups from Remote Desktop Users groups.

### M1035 Limit Access to Resource Over Network

Use remote desktop gateways.

### M1030 Network Segmentation

Do not leave RDP accessible from the internet. Enable firewall rules to block RDP traffic between network security zones within a network.

### M1028 Operating System Configuration

Change GPOs to define shorter timeouts sessions and maximum amount of time any single session can be active. Change GPOs to specify the maximum amount of time that a disconnected session stays active on the RD session host server.

### M1042 Disable or Remove Feature or Program

Disable the RDP service if it is unnecessary.

### M1018 User Account Management

Limit remote user permissions if remote access is necessary.

### M1032 Multi-factor Authentication

Use multi-factor authentication for remote logins.

### M1026 Privileged Account Management

Consider removing the local Administrators group from the list of groups allowed to log in through RDP.

## Detection

### Multi-event Detection Strategy for RDP-Based Remote Logins and Post-Access Activity

## Risk Assessment

| Finding                                      | Severity | Impact           |
| -------------------------------------------- | -------- | ---------------- |
| Remote Desktop Protocol technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Alperovitch Malware](https://web.archive.org/web/20191115195333/https://www.crowdstrike.com/blog/adversary-tricks-crowdstrike-treats/)
- [TechNet Remote Desktop Services](https://technet.microsoft.com/en-us/windowsserver/ee236407.aspx)
- [Atomic Red Team - T1021.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.001)
- [MITRE ATT&CK - T1021.001](https://attack.mitre.org/techniques/T1021/001)
