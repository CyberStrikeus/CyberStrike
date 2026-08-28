---
name: "T1556.001_domain-controller-authentication"
description: "Adversaries may patch the authentication process on a domain controller to bypass the typical authentication mechanisms and enable access to accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.001
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - sub-technique
technique_id: "T1556.001"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1556/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.006
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
  T1556.003: "Chain with T1556.003 for deeper attack path"
---

# T1556.001 Domain Controller Authentication

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may patch the authentication process on a domain controller to bypass the typical authentication mechanisms and enable access to accounts.

Malware may be used to inject false credentials into the authentication process on a domain controller with the intent of creating a backdoor used to access any user’s account and/or credentials (ex: Skeleton Key). Skeleton key works through a patch on an enterprise domain controller authentication process (LSASS) with credentials that adversaries may use to bypass the standard authentication system. Once patched, an adversary can use the injected password to successfully authenticate as any domain user account (until the the skeleton key is erased from memory by a reboot of the domain controller). Authenticated access may enable unfettered access to hosts and/or resources within single-factor authentication environments.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Domain Controller Authentication technique is applicable to target environment
- [ ] Check Windows systems for indicators of Domain Controller Authentication
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Skeleton Key via Mimikatz

Injects a Skeleton Key into LSASS on a domain controller using Mimikatz. Once injected, any domain
user account can be authenticated using the password 'mimikatz' until the domain controller is rebooted.

This test must be run on an isolated domain controller and must not be performed on a production DC.
Cleanup forces a reboot of the domain controller to evict the skeleton key from LSASS memory.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
& "#{mimikatz_path}" "privilege::debug" "misc::skeleton" "exit"
```

**Dependencies:**

- Mimikatz must be present on the host machine at

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Controller Authentication by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Audit domain and local accounts as well as their permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. These audits should also include if default accounts have been enabled, or if new local accounts are created that have not be authorized. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1025 Privileged Process Integrity

Enabled features, such as Protected Process Light (PPL), for LSA.

### M1032 Multi-factor Authentication

Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

### M1017 User Training

Train users to recognize and handle suspicious email attachments. Emphasize the importance of caution when opening attachments from unknown or unexpected sources, even if they appear legitimate. Implement email warning banners to alert users about emails originating from outside the organization or containing attachments, reinforcing awareness and helping users identify potential spearphishing attempts.

## Detection

### Detect Domain Controller Authentication Process Modification (Skeleton Key)

## Risk Assessment

| Finding                                               | Severity | Impact            |
| ----------------------------------------------------- | -------- | ----------------- |
| Domain Controller Authentication technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Dell Skeleton](https://www.secureworks.com/research/skeleton-key-malware-analysis)
- [TechNet Audit Policy](https://technet.microsoft.com/en-us/library/dn487457.aspx)
- [Atomic Red Team - T1556.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.001)
- [MITRE ATT&CK - T1556.001](https://attack.mitre.org/techniques/T1556/001)
