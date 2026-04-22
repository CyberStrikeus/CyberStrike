---
name: "T1563.002_rdp-hijacking"
description: "Adversaries may hijack a legitimate user’s remote desktop session to move laterally within an environment."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1563.002
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1563.002"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1563/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1563
  - T1563.001
prerequisites:
  - T1563
severity_boost:
  T1563: "Chain with T1563 for deeper attack path"
  T1563.001: "Chain with T1563.001 for deeper attack path"
---

# T1563.002 RDP Hijacking

> **Sub-technique of:** T1563

## High-Level Description

Adversaries may hijack a legitimate user’s remote desktop session to move laterally within an environment. Remote desktop is a common feature in operating systems. It allows a user to log into an interactive session with a system desktop graphical user interface on a remote system. Microsoft refers to its implementation of the Remote Desktop Protocol (RDP) as Remote Desktop Services (RDS).

Adversaries may perform RDP session hijacking which involves stealing a legitimate user's remote session. Typically, a user is notified when someone else is trying to steal their session. With System permissions and using Terminal Services Console, `c:\windows\system32\tscon.exe [session number to be stolen]`, an adversary can hijack a session without the need for credentials or prompts to the user. This can be done remotely or locally and with active or disconnected sessions. It can also lead to Remote System Discovery and Privilege Escalation by stealing a Domain Admin or higher privileged account session. All of this can be done by using native Windows commands, but it has also been added as a feature in red teaming tools.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if RDP Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of RDP Hijacking
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: RDP hijacking

[RDP hijacking](https://medium.com/@networksecurity/rdp-hijacking-how-to-hijack-rds-and-remoteapp-sessions-transparently-to-move-through-an-da2a1e73a5f6) - how to hijack RDS and RemoteApp sessions transparently to move through an organization

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
query user
sc.exe create sesshijack binpath= "cmd.exe /k tscon #{Session_ID} /dest:#{Destination_ID}"
net start sesshijack
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to RDP Hijacking by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1563.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1035 Limit Access to Resource Over Network

Use remote desktop gateways.

### M1030 Network Segmentation

Enable firewall rules to block RDP traffic between network security zones within a network.

### M1028 Operating System Configuration

Change GPOs to define shorter timeouts sessions and maximum amount of time any single session can be active. Change GPOs to specify the maximum amount of time that a disconnected session stays active on the RD session host server.

### M1018 User Account Management

Limit remote user permissions if remote access is necessary.

### M1047 Audit

Audit the Remote Desktop Users group membership regularly. Remove unnecessary accounts and groups from Remote Desktop Users groups.

### M1042 Disable or Remove Feature or Program

Disable the RDP service if it is unnecessary.

### M1026 Privileged Account Management

Consider removing the local Administrators group from the list of groups allowed to log in through RDP.

## Detection

### Detection fo Remote Service Session Hijacking for RDP.

## Risk Assessment

| Finding                            | Severity | Impact           |
| ---------------------------------- | -------- | ---------------- |
| RDP Hijacking technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [RDP Hijacking Medium](https://medium.com/@networksecurity/rdp-hijacking-how-to-hijack-rds-and-remoteapp-sessions-transparently-to-move-through-an-da2a1e73a5f6)
- [RDP Hijacking Korznikov](http://www.korznikov.com/2017/03/0-day-or-feature-privilege-escalation.html)
- [TechNet Remote Desktop Services](https://technet.microsoft.com/en-us/windowsserver/ee236407.aspx)
- [Kali Redsnarf](https://github.com/nccgroup/redsnarf)
- [Atomic Red Team - T1563.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1563.002)
- [MITRE ATT&CK - T1563.002](https://attack.mitre.org/techniques/T1563/002)
