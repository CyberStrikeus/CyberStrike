---
name: "T1110_brute-force"
description: "Adversaries may use brute force techniques to gain access to accounts when passwords are unknown or when password hashes are obtained."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1110
  - credential-access
  - containers
  - esxi
  - iaas
  - identity-provider
  - linux
  - macos
  - network-devices
  - office-suite
  - saas
  - windows
technique_id: "T1110"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Containers
  - ESXi
  - IaaS
  - Identity Provider
  - Linux
  - macOS
  - Network Devices
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1110"
tech_stack:
  - containers
  - esxi
  - cloud
  - identity
  - linux
  - macos
  - network devices
  - office
  - saas
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1110.001
  - T1110.002
  - T1110.003
  - T1110.004
prerequisites:
  []
severity_boost:
  T1110.001: "Chain with T1110.001 for deeper attack path"
  T1110.002: "Chain with T1110.002 for deeper attack path"
  T1110.003: "Chain with T1110.003 for deeper attack path"
---

# T1110 Brute Force

## High-Level Description

Adversaries may use brute force techniques to gain access to accounts when passwords are unknown or when password hashes are obtained. Without knowledge of the password for an account or set of accounts, an adversary may systematically guess the password using a repetitive or iterative mechanism. Brute forcing passwords can take place via interaction with a service that will check the validity of those credentials or offline against previously acquired credential data, such as password hashes.

Brute forcing credentials may take place at various points during a breach. For example, adversaries may attempt to brute force access to Valid Accounts within a victim environment leveraging knowledge gathered from other post-compromise behaviors such as OS Credential Dumping, Account Discovery, or Password Policy Discovery. Adversaries may also combine brute forcing activity with behaviors such as External Remote Services as part of Initial Access. 

If an adversary guesses the correct password but fails to login to a compromised account due to location-based conditional access policies, they may change their infrastructure until they match the victim’s location and therefore bypass those policies.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Containers, ESXi, IaaS, Identity Provider, Linux, macOS, Network Devices, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Brute Force technique is applicable to target environment
- [ ] Check Containers systems for indicators of Brute Force
- [ ] Check ESXi systems for indicators of Brute Force
- [ ] Check IaaS systems for indicators of Brute Force
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Brute Force by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1110 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Proactively reset accounts that are known to be part of breached credentials either immediately, or after detecting bruteforce attempts.

### M1036 Account Use Policies
Set account lockout policies after a certain number of failed login attempts to prevent passwords from being guessed. Too strict a policy may create a denial of service condition and render environments un-usable, with all accounts used in the brute force being locked-out. Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges. Consider blocking risky authentication requests, such as those originating from anonymizing services/proxies.

### M1032 Multi-factor Authentication
Use multi-factor authentication. Where possible, also enable multi-factor authentication on externally facing services.

### M1027 Password Policies
Refer to NIST guidelines when creating password policies.


## Detection

### Brute Force Authentication Failures with Multi-Platform Log Correlation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Brute Force technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [TrendMicro Pawn Storm Dec 2020](https://www.trendmicro.com/en_us/research/20/l/pawn-storm-lack-of-sophistication-as-a-strategy.html)
- [ReliaQuest Health Care Social Engineering Campaign 2024](https://www.reliaquest.com/blog/health-care-social-engineering-campaign/)
- [Dragos Crashoverride 2018](https://www.dragos.com/wp-content/uploads/CRASHOVERRIDE2018.pdf)
- [Atomic Red Team - T1110](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1110)
- [MITRE ATT&CK - T1110](https://attack.mitre.org/techniques/T1110)
