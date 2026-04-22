---
name: "T1199_trusted-relationship"
description: "Adversaries may breach or otherwise leverage organizations who have access to intended victims."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1199
  - initial-access
  - windows
  - saas
  - iaas
  - linux
  - macos
  - identity-provider
  - office-suite
technique_id: "T1199"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Windows
  - SaaS
  - IaaS
  - Linux
  - macOS
  - Identity Provider
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1199"
tech_stack:
  - windows
  - saas
  - cloud
  - linux
  - macos
  - identity
  - office
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1199 Trusted Relationship

## High-Level Description

Adversaries may breach or otherwise leverage organizations who have access to intended victims. Access through trusted third party relationship abuses an existing connection that may not be protected or receives less scrutiny than standard mechanisms of gaining access to a network.

Organizations often grant elevated access to second or third-party external providers in order to allow them to manage internal systems as well as cloud-based environments. Some examples of these relationships include IT services contractors, managed security providers, infrastructure contractors (e.g. HVAC, elevators, physical security). The third-party provider's access may be intended to be limited to the infrastructure being maintained, but may exist on the same network as the rest of the enterprise. As such, Valid Accounts used by the other party for access to internal network systems may be compromised and used.

In Office 365 environments, organizations may grant Microsoft partners or resellers delegated administrator permissions. By compromising a partner or reseller account, an adversary may be able to leverage existing delegated administrator relationships or send new delegated administrator offers to clients in order to gain administrative control over the victim tenant.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Identity Provider, Office Suite

## What to Check

- [ ] Identify if Trusted Relationship technique is applicable to target environment
- [ ] Check Windows systems for indicators of Trusted Relationship
- [ ] Check SaaS systems for indicators of Trusted Relationship
- [ ] Check IaaS systems for indicators of Trusted Relationship
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Trusted Relationship by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1199 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Require MFA for all delegated administrator accounts.

### M1018 User Account Management
Properly manage accounts and permissions used by parties in trusted relationships to minimize potential abuse by the party and if the party is compromised by an adversary. In Office 365 environments, partner relationships and roles can be viewed under the “Partner Relationships” page.

### M1030 Network Segmentation
Network segmentation can be used to isolate infrastructure components that do not require broad network access.


## Detection

### Detect abuse of Trusted Relationships (third-party and delegated admin access)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Trusted Relationship technique applicable | Low | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [CISA IT Service Providers](https://us-cert.cisa.gov/APTs-Targeting-IT-Service-Provider-Customers)
- [Office 365 Delegated Administration](https://support.microsoft.com/en-us/topic/partners-offer-delegated-administration-26530dc0-ebba-415b-86b1-b55bc06b073e?ui=en-us&rs=en-us&ad=us)
- [Atomic Red Team - T1199](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1199)
- [MITRE ATT&CK - T1199](https://attack.mitre.org/techniques/T1199)
