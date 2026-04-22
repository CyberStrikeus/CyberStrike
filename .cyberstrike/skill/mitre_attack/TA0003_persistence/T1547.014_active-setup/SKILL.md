---
name: "T1547.014_active-setup"
description: "Adversaries may achieve persistence by adding a Registry key to the Active Setup of the local machine."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.014
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.014"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/014"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.014 Active Setup

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may achieve persistence by adding a Registry key to the Active Setup of the local machine. Active Setup is a Windows mechanism that is used to execute programs when a user logs in. The value stored in the Registry key will be executed after a user logs into the computer. These programs will be executed under the context of the user and will have the account's associated permissions level.

Adversaries may abuse Active Setup by creating a key under <code> HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components\</code> and setting a malicious value for <code>StubPath</code>. This value will serve as the program that will be executed when a user logs into the computer.

Adversaries can abuse these components to execute malware, such as remote access tools, to maintain persistence through system reboots. Adversaries may also use Masquerading to make the Registry entries look as if they are associated with legitimate programs.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Active Setup technique is applicable to target environment
- [ ] Check Windows systems for indicators of Active Setup
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: HKLM - Add atomic_test key to launch executable as part of user setup

This test will create an "atomic_test" key under 'HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components' to launch calc by configuring an active setup executable and
forcing to run active setup using the "runonce.exe /AlternateShellStartup" command.
Without the "runonce.exe /AlternateShellStartup" command it would run during the next logon for each user.

Note: If you logout before running the cleanup command, you will be required to go through the OOBE (out-of-box experience) setup sequence to log back in.
The payload will only run once unless the cleanup command is run in between tests.

[Active Setup Explained](https://helgeklein.com/blog/active-setup-explained/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-Item "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components" -Name "atomic_test" -Force
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\atomic_test" "(Default)" "ART TEST" -Force
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\atomic_test" "StubPath" "#{payload}" -Force
& $env:SYSTEMROOT\system32\runonce.exe /AlternateShellStartup
```

### Atomic Test 2: HKLM - Add malicious StubPath value to existing Active Setup Entry

This test will add a StubPath entry to the Active Setup native registry key associated with 'Internet Explorer Core Fonts' (UUID {C9E9A340-D1F1-11D0-821E-444553540600})
Said key doesn't have a StubPath value by default, by adding one it will launch calc by forcing to run active setup using runonce.exe /AlternateShellStartup.
Without the last command it will normally run on next user logon. Note: this test will only run once successfully if no cleanup command is run in between test.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{C9E9A340-D1F1-11D0-821E-444553540600}" "StubPath" "#{payload}" -Force
& $env:SYSTEMROOT\system32\runonce.exe /AlternateShellStartup
```

### Atomic Test 3: HKLM - re-execute 'Internet Explorer Core Fonts' StubPath payload by decreasing version number

This test will decrease the version number of the 'Internet Explorer Core Fonts' (UUID {C9E9A340-D1F1-11D0-821E-444553540600}) registry key for the current user,
which will force the StubPath payload (if set) to execute.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Active Setup\Installed Components\{C9E9A340-D1F1-11D0-821E-444553540600}" -Name "Version" -Value "0,0,0,0"
& $env:SYSTEMROOT\system32\runonce.exe /AlternateShellStartup
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Active Setup by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Active Setup Persistence via StubPath Execution

## Risk Assessment

| Finding                           | Severity | Impact      |
| --------------------------------- | -------- | ----------- |
| Active Setup technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [SECURELIST Bright Star 2015](https://securelist.com/whos-really-spreading-through-the-bright-star/68978/)
- [Mandiant Glyer APT 2010](https://digital-forensics.sans.org/summit-archives/2010/35-glyer-apt-persistence-mechanisms.pdf)
- [FireEye CFR Watering Hole 2012](https://web.archive.org/web/20201024230407/https://www.fireeye.com/blog/threat-research/2012/12/council-foreign-relations-water-hole-attack-details.html)
- [Klein Active Setup 2010](https://helgeklein.com/blog/2010/04/active-setup-explained/)
- [paloalto Tropic Trooper 2016](https://unit42.paloaltonetworks.com/unit42-tropic-trooper-targets-taiwanese-government-and-fossil-fuel-provider-with-poison-ivy/)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Citizenlab Packrat 2015](https://citizenlab.ca/2015/12/packrat-report/)
- [Atomic Red Team - T1547.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.014)
- [MITRE ATT&CK - T1547.014](https://attack.mitre.org/techniques/T1547/014)
