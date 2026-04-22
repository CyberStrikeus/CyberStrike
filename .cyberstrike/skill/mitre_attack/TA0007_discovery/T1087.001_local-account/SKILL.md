---
name: "T1087.001_local-account"
description: "Adversaries may attempt to get a listing of local system accounts."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1087.001
  - discovery
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1087.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1087/001"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1087
  - T1087.002
  - T1087.003
  - T1087.004
prerequisites:
  - T1087
severity_boost:
  T1087: "Chain with T1087 for deeper attack path"
  T1087.002: "Chain with T1087.002 for deeper attack path"
  T1087.003: "Chain with T1087.003 for deeper attack path"
---

# T1087.001 Local Account

> **Sub-technique of:** T1087

## High-Level Description

Adversaries may attempt to get a listing of local system accounts. This information can help adversaries determine which local accounts exist on a system to aid in follow-on behavior.

Commands such as <code>net user</code> and <code>net localgroup</code> of the Net utility and <code>id</code> and <code>groups</code> on macOS and Linux can list local users and groups. On Linux, local users can also be enumerated through the use of the <code>/etc/passwd</code> file. On macOS, the <code>dscl . list /Users</code> command can be used to enumerate local accounts. On ESXi servers, the `esxcli system account list` command can list local user accounts.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Local Account technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Local Account
- [ ] Check Linux systems for indicators of Local Account
- [ ] Check macOS systems for indicators of Local Account
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enumerate all accounts (Local)

Enumerate all accounts by copying /etc/passwd to another file

**Supported Platforms:** linux

```bash
cat /etc/passwd > #{output_file}
cat #{output_file}
```

### Atomic Test 2: View sudoers access

(requires root)

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
if [ -f /etc/sudoers ]; then sudo cat /etc/sudoers > #{output_file}; fi;
if [ -f /usr/local/etc/sudoers ]; then sudo cat /usr/local/etc/sudoers > #{output_file}; fi;
cat #{output_file}
```

### Atomic Test 3: View accounts with UID 0

View accounts with UID 0

**Supported Platforms:** linux, macos

```bash
grep 'x:0:' /etc/passwd > #{output_file}
grep '*:0:' /etc/passwd >> #{output_file}
cat #{output_file} 2>/dev/null
```

### Atomic Test 4: List opened files by user

List opened files by user

**Supported Platforms:** linux, macos

```bash
username=$(id -u -n) && lsof -u $username
```

**Dependencies:**

- check if lsof exists

### Atomic Test 5: Show if a user account has ever logged in remotely

Show if a user account has ever logged in remotely

**Supported Platforms:** linux

```bash
[ "$(uname)" = 'FreeBSD' ] && cmd="lastlogin" || cmd="lastlog"
$cmd > #{output_file}
cat #{output_file}
```

**Dependencies:**

- Check if lastlog command exists on the machine

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Account by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1087.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

Prevent administrator accounts from being enumerated when an application is elevating through UAC since it can lead to the disclosure of account names. The Registry key is located at <code>HKLM\ SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\CredUI\EnumerateAdministrators</code>. It can be disabled through GPO: Computer Configuration > [Policies] > Administrative Templates > Windows Components > Credential User Interface: Enumerate administrator accounts on elevation.

## Detection

### Local Account Enumeration Across Host Platforms

## Risk Assessment

| Finding                            | Severity | Impact    |
| ---------------------------------- | -------- | --------- |
| Local Account technique applicable | Low      | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [id man page](https://linux.die.net/man/1/id)
- [groups man page](https://linux.die.net/man/1/groups)
- [Mandiant APT1](https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/mandiant-apt1-report.pdf)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [Elastic - Koadiac Detection with EQL](https://www.elastic.co/security-labs/embracing-offensive-tooling-building-detections-against-koadic-using-eql)
- [Atomic Red Team - T1087.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1087.001)
- [MITRE ATT&CK - T1087.001](https://attack.mitre.org/techniques/T1087/001)
