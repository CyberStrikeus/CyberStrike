---
name: "T1134.005_sid-history-injection"
description: "Adversaries may use SID-History Injection to escalate privileges and bypass access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134.005
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1134.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134
  - T1134.001
  - T1134.002
  - T1134.003
  - T1134.004
prerequisites:
  - T1134
severity_boost:
  T1134: "Chain with T1134 for deeper attack path"
  T1134.001: "Chain with T1134.001 for deeper attack path"
  T1134.002: "Chain with T1134.002 for deeper attack path"
---

# T1134.005 SID-History Injection

> **Sub-technique of:** T1134

## High-Level Description

Adversaries may use SID-History Injection to escalate privileges and bypass access controls. The Windows security identifier (SID) is a unique value that identifies a user or group account. SIDs are used by Windows security in both security descriptors and access tokens. An account can hold additional SIDs in the SID-History Active Directory attribute , allowing inter-operable account migration between domains (e.g., all values in SID-History are included in access tokens).

With Domain Administrator (or equivalent) rights, harvested or well-known SID values may be inserted into SID-History to enable impersonation of arbitrary users/groups such as Enterprise Administrators. This manipulation may result in elevated access to local resources and/or access to otherwise inaccessible domains via lateral movement techniques such as Remote Services, SMB/Windows Admin Shares, or Windows Remote Management.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if SID-History Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of SID-History Injection
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Injection SID-History with mimikatz

Adversaries may use SID-History Injection to escalate privileges and bypass access controls. Must be run on domain controller

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
#{mimikatz_path} "privilege::debug" "sid::patch" "sid::add /sid:#{sid_to_inject} /sam:#{sam_account_name}" "exit"
```

**Dependencies:**
- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SID-History Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1015 Active Directory Configuration
Clean up SID-History attributes after legitimate account migration is complete.

Consider applying SID Filtering to interforest trusts, such as forest trusts and external trusts, to exclude SID-History from requests to access domain resources. SID Filtering ensures that any authentication requests over a trust only contain SIDs of security principals from the trusted domain (i.e preventing the trusted domain from claiming a user has membership in groups outside of the domain).

SID Filtering of forest trusts is enabled by default, but may have been disabled in some cases to allow a child domain to transitively access forest trusts. SID Filtering of external trusts is automatically enabled on all created external trusts using Server 2003 or later domain controllers. However note that SID Filtering is not automatically applied to legacy trusts or may have been deliberately disabled to allow inter-domain access to resources.

SID Filtering can be applied by: 

* Disabling SIDHistory on forest trusts using the netdom tool (<code>netdom trust /domain: /EnableSIDHistory:no</code> on the domain controller)

* Applying SID Filter Quarantining to external trusts using the netdom tool (<code>netdom trust <TrustingDomainName> /domain:<TrustedDomainName> /quarantine:yes</code> on the domain controller)

* Applying SID Filtering to domain trusts within a single forest is not recommended as it is an unsupported configuration and can cause breaking changes. If a domain within a forest is untrustworthy then it should not be a member of the forest. In this situation it is necessary to first split the trusted and untrusted domains into separate forests where SID Filtering can be applied to an interforest trust


## Detection

### Behavior-chain detection for T1134.005 Access Token Manipulation: SID-History Injection (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SID-History Injection technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft SID](https://msdn.microsoft.com/library/windows/desktop/aa379571.aspx)
- [Microsoft SID-History Attribute](https://msdn.microsoft.com/library/ms679833.aspx)
- [Microsoft Well Known SIDs Jun 2017](https://support.microsoft.com/help/243330/well-known-security-identifiers-in-windows-operating-systems)
- [Microsoft Get-ADUser](https://technet.microsoft.com/library/ee617241.aspx)
- [AdSecurity SID History Sept 2015](https://adsecurity.org/?p=1772)
- [Microsoft DsAddSidHistory](https://msdn.microsoft.com/library/ms677982.aspx)
- [Atomic Red Team - T1134.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134.005)
- [MITRE ATT&CK - T1134.005](https://attack.mitre.org/techniques/T1134/005)
