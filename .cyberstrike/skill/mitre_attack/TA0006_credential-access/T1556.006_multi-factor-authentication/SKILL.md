---
name: "T1556.006_multi-factor-authentication"
description: "Adversaries may disable or modify multi-factor authentication (MFA) mechanisms to enable persistent access to compromised accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.006
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - saas
  - iaas
  - linux
  - macos
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1556.006"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
  - SaaS
  - IaaS
  - Linux
  - macOS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1556/006"
tech_stack:
  - windows
  - saas
  - cloud
  - linux
  - macos
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.006 Multi-Factor Authentication

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may disable or modify multi-factor authentication (MFA) mechanisms to enable persistent access to compromised accounts.

Once adversaries have gained access to a network by either compromising an account lacking MFA or by employing an MFA bypass method such as Multi-Factor Authentication Request Generation, adversaries may leverage their access to modify or completely disable MFA defenses. This can be accomplished by abusing legitimate features, such as excluding users from Azure AD Conditional Access Policies, registering a new yet vulnerable/adversary-controlled MFA method, or by manually patching MFA programs and configuration files to bypass expected functionality.

For example, modifying the Windows hosts file (`C:\windows\system32\drivers\etc\hosts`) to redirect MFA calls to localhost instead of an MFA server may cause the MFA process to fail. If a "fail open" policy is in place, any otherwise successful authentication attempt may be granted access without enforcing MFA.

Depending on the scope, goals, and privileges of the adversary, MFA defenses may be disabled for individual accounts or for all accounts tied to a larger group, such as all domain accounts in a victim's network environment.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Multi-Factor Authentication technique is applicable to target environment
- [ ] Check Windows systems for indicators of Multi-Factor Authentication
- [ ] Check SaaS systems for indicators of Multi-Factor Authentication
- [ ] Check IaaS systems for indicators of Multi-Factor Authentication
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Multi-Factor Authentication by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Ensure that proper policies are implemented to dictate the secure enrollment and deactivation of MFA for user accounts.

### M1047 Audit

Review MFA actions alongside authentication logs to ensure that MFA-based logins are functioning as intended. Review user accounts to ensure that all accounts have MFA enabled.

### M1032 Multi-factor Authentication

Ensure that MFA and MFA policies and requirements are properly implemented for existing and deactivated or dormant accounts and devices. If possible, consider configuring MFA solutions to "fail closed" rather than grant access in case of serious errors.

## Detection

### Detect MFA Modification or Disabling Across Platforms

## Risk Assessment

| Finding                                          | Severity | Impact            |
| ------------------------------------------------ | -------- | ----------------- |
| Multi-Factor Authentication technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Russians Exploit Default MFA Protocol - CISA March 2022](https://www.cisa.gov/uscert/ncas/alerts/aa22-074a)
- [Mandiant APT42](https://www.mandiant.com/media/17826)
- [Azure AD Conditional Access Exclusions](https://docs.microsoft.com/en-us/azure/active-directory/governance/conditional-access-exclusion)
- [Atomic Red Team - T1556.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.006)
- [MITRE ATT&CK - T1556.006](https://attack.mitre.org/techniques/T1556/006)
