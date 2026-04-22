---
name: "T1484.001_group-policy-modification"
description: "Adversaries may modify Group Policy Objects (GPOs) to subvert the intended discretionary access controls for a domain, usually with the intention of escalating privileges on the domain."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1484.001
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1484.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1484/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1484
  - T1484.002
prerequisites:
  - T1484
severity_boost:
  T1484: "Chain with T1484 for deeper attack path"
  T1484.002: "Chain with T1484.002 for deeper attack path"
---

# T1484.001 Group Policy Modification

> **Sub-technique of:** T1484

## High-Level Description

Adversaries may modify Group Policy Objects (GPOs) to subvert the intended discretionary access controls for a domain, usually with the intention of escalating privileges on the domain. Group policy allows for centralized management of user and computer settings in Active Directory (AD). GPOs are containers for group policy settings made up of files stored within a predictable network path `\<DOMAIN>\SYSVOL\<DOMAIN>\Policies\`. 

Like other objects in AD, GPOs have access controls associated with them. By default all user accounts in the domain have permission to read GPOs. It is possible to delegate GPO access control permissions, e.g. write access, to specific users or groups in the domain.

Malicious GPO modifications can be used to implement many other malicious behaviors such as Scheduled Task/Job, Disable or Modify Tools, Ingress Tool Transfer, Create Account, Service Execution, and more. Since GPOs can control so many user and machine settings in the AD environment, there are a great number of potential attacks that can stem from this GPO abuse.

For example, publicly available scripts such as <code>New-GPOImmediateTask</code> can be leveraged to automate the creation of a malicious Scheduled Task/Job by modifying GPO settings, in this case modifying <code>&lt;GPO_PATH&gt;\Machine\Preferences\ScheduledTasks\ScheduledTasks.xml</code>. In some cases an adversary might modify specific user rights like SeEnableDelegationPrivilege, set in <code>&lt;GPO_PATH&gt;\MACHINE\Microsoft\Windows NT\SecEdit\GptTmpl.inf</code>, to achieve a subtle AD backdoor with complete control of the domain because the user account under the adversary's control would then be able to modify GPOs.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Group Policy Modification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Group Policy Modification
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: LockBit Black - Modify Group policy settings -cmd

An adversary can modify the group policy settings.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v GroupPolicyRefreshTimeDC /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v GroupPolicyRefreshTimeOffsetDC /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v GroupPolicyRefreshTime /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v GroupPolicyRefreshTimeOffset /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v EnableSmartScreen /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" /v ShellSmartScreenLevel /t REG_SZ /d Block /f
```

### Atomic Test 2: LockBit Black - Modify Group policy settings -Powershell

An adversary modifies group policy settings

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name GroupPolicyRefreshTimeDC -PropertyType DWord -Value 0 -Force
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name GroupPolicyRefreshTimeOffsetDC -PropertyType DWord -Value 0 -Force
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name GroupPolicyRefreshTime -PropertyType DWord -Value 0 -Force
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name GroupPolicyRefreshTimeOffset -PropertyType DWord -Value 0 -Force
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name EnableSmartScreen -PropertyType DWord -Value 0 -Force
New-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name ShellSmartScreenLevel -Force
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Group Policy Modification by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1484.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Identify and correct GPO permissions abuse opportunities (ex: GPO modification privileges) using auditing tools such as BloodHound (version 1.5.1 and later).

### M1018 User Account Management
Consider implementing WMI and security filtering to further tailor which users and computers a GPO will apply to.


## Detection

### Detection of Group Policy Modifications via AD Object Changes and File Activity


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Group Policy Modification technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Mandiant M Trends 2016](https://web.archive.org/web/20211024160454/https://www.fireeye.com/content/dam/fireeye-www/current-threats/pdfs/rpt-mtrends-2016.pdf)
- [ADSecurity GPO Persistence 2016](https://adsecurity.org/?p=2716)
- [Microsoft Hacking Team Breach](https://www.microsoft.com/security/blog/2016/06/01/hacking-team-breach-a-cyber-jurassic-park/)
- [Wald0 Guide to GPOs](https://wald0.com/?p=179)
- [Harmj0y Abusing GPO Permissions](https://blog.harmj0y.net/redteaming/abusing-gpo-permissions/)
- [Harmj0y SeEnableDelegationPrivilege Right](https://blog.harmj0y.net/activedirectory/the-most-dangerous-user-right-you-probably-have-never-heard-of/)
- [TechNet Group Policy Basics](https://blogs.technet.microsoft.com/musings_of_a_technical_tam/2012/02/13/group-policy-basics-part-1-understanding-the-structure-of-a-group-policy-object/)
- [Atomic Red Team - T1484.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1484.001)
- [MITRE ATT&CK - T1484.001](https://attack.mitre.org/techniques/T1484/001)
