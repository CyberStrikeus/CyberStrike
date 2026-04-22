---
name: "T1482_domain-trust-discovery"
description: "Adversaries may attempt to gather information on domain trust relationships that may be used to identify lateral movement opportunities in Windows multi-domain/forest environments."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1482
  - discovery
  - windows
technique_id: "T1482"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1482"
tech_stack:
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1482 Domain Trust Discovery

## High-Level Description

Adversaries may attempt to gather information on domain trust relationships that may be used to identify lateral movement opportunities in Windows multi-domain/forest environments. Domain trusts provide a mechanism for a domain to allow access to resources based on the authentication procedures of another domain. Domain trusts allow the users of the trusted domain to access resources in the trusting domain. The information discovered may help the adversary conduct SID-History Injection, Pass the Ticket, and Kerberoasting. Domain trusts can be enumerated using the `DSEnumerateDomainTrusts()` Win32 API call, .NET methods, and LDAP. The Windows utility Nltest is known to be used by adversaries to enumerate domain trusts.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows

## What to Check

- [ ] Identify if Domain Trust Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of Domain Trust Discovery
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Windows - Discover domain trusts with dsquery

Uses the dsquery command to discover domain trusts.
Requires the installation of dsquery via Windows RSAT or the Windows Server AD DS role.

**Supported Platforms:** windows

```cmd
dsquery * -filter "(objectClass=trustedDomain)" -attr *
```

### Atomic Test 2: Windows - Discover domain trusts with nltest

Uses the nltest command to discover domain trusts.
Requires the installation of nltest via Windows RSAT or the Windows Server AD DS role.
This technique has been used by the Trickbot malware family.

**Supported Platforms:** windows

```cmd
nltest /domain_trusts
nltest /trusted_domains
```

**Dependencies:**

- nltest.exe from RSAT must be present on disk

### Atomic Test 3: Powershell enumerate domains and forests

Use powershell to enumerate AD information.
Requires the installation of PowerShell AD admin cmdlets via Windows RSAT or the Windows Server AD DS role.

**Supported Platforms:** windows

```powershell
Import-Module "PathToAtomicsFolder\..\ExternalPayloads\PowerView.ps1"
Get-NetDomainTrust
Get-NetForestTrust
Get-ADDomain
Get-ADGroupMember Administrators -Recursive
([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()).GetAllTrustRelationships()
```

**Dependencies:**

- PowerView PowerShell script must exist on disk
- RSAT PowerShell AD admin cmdlets must be installed

### Atomic Test 4: Adfind - Enumerate Active Directory OUs

Adfind tool can be used for reconnaissance in an Active directory environment. This example has been documented by ransomware actors enumerating Active Directory OUs
reference- http://www.joeware.net/freetools/tools/adfind/, https://www.fireeye.com/blog/threat-research/2019/04/pick-six-intercepting-a-fin6-intrusion.html

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe" -f (objectcategory=organizationalUnit) #{optional_args}
```

**Dependencies:**

- AdFind.exe must exist on disk at specified location (PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe)

### Atomic Test 5: Adfind - Enumerate Active Directory Trusts

Adfind tool can be used for reconnaissance in an Active directory environment. This example has been documented by ransomware actors enumerating Active Directory Trusts
reference- http://www.joeware.net/freetools/tools/adfind/, https://www.fireeye.com/blog/threat-research/2019/04/pick-six-intercepting-a-fin6-intrusion.html

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe" #{optional_args} -gcb -sc trustdmp
```

**Dependencies:**

- AdFind.exe must exist on disk at specified location (PathToAtomicsFolder\..\ExternalPayloads\AdFind.exe)

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Trust Discovery by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1482 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Map the trusts within existing domains/forests and keep trust relationships to a minimum.

### M1030 Network Segmentation

Employ network segmentation for sensitive domains..

## Detection

### Detection of Domain Trust Discovery via API, Script, and CLI Enumeration

## Risk Assessment

| Finding                                     | Severity | Impact    |
| ------------------------------------------- | -------- | --------- |
| Domain Trust Discovery technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Microsoft Operation Wilysupply](https://www.microsoft.com/security/blog/2017/05/04/windows-defender-atp-thwarts-operation-wilysupply-software-supply-chain-cyberattack/)
- [AdSecurity Forging Trust Tickets](https://adsecurity.org/?p=1588)
- [Microsoft Trusts](<https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2003/cc759554(v=ws.10)>)
- [Microsoft GetAllTrustRelationships](https://docs.microsoft.com/en-us/dotnet/api/system.directoryservices.activedirectory.domain.getalltrustrelationships?redirectedfrom=MSDN&view=netframework-4.7.2#System_DirectoryServices_ActiveDirectory_Domain_GetAllTrustRelationships)
- [Harmj0y Domain Trusts](https://posts.specterops.io/a-guide-to-attacking-domain-trusts-971e52cb2944)
- [Atomic Red Team - T1482](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1482)
- [MITRE ATT&CK - T1482](https://attack.mitre.org/techniques/T1482)
