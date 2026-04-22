---
name: "T1556.009_conditional-access-policies"
description: "Adversaries may disable or modify conditional access policies to enable persistent access to compromised accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.009
  - credential-access
  - defense-evasion
  - persistence
  - iaas
  - identity-provider
  - sub-technique
technique_id: "T1556.009"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - IaaS
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1556/009"
tech_stack:
  - cloud
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
  - T1556.006
  - T1556.007
  - T1556.008
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.009 Conditional Access Policies

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may disable or modify conditional access policies to enable persistent access to compromised accounts. Conditional access policies are additional verifications used by identity providers and identity and access management systems to determine whether a user should be granted access to a resource.

For example, in Entra ID, Okta, and JumpCloud, users can be denied access to applications based on their IP address, device enrollment status, and use of multi-factor authentication. In some cases, identity providers may also support the use of risk-based metrics to deny sign-ins based on a variety of indicators. In AWS and GCP, IAM policies can contain `condition` attributes that verify arbitrary constraints such as the source IP, the date the request was made, and the nature of the resources or regions being requested. These measures help to prevent compromised credentials from resulting in unauthorized access to data or resources, as well as limit user permissions to only those required. 

By modifying conditional access policies, such as adding additional trusted IP ranges, removing Multi-Factor Authentication requirements, or allowing additional Unused/Unsupported Cloud Regions, adversaries may be able to ensure persistent access to accounts and circumvent defensive measures.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** IaaS, Identity Provider

## What to Check

- [ ] Identify if Conditional Access Policies technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Conditional Access Policies
- [ ] Check Identity Provider systems for indicators of Conditional Access Policies
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Conditional Access Policies by examining the target platforms (IaaS, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Limit permissions to modify conditional access policies to only those required.


## Detection

### Detect Conditional Access Policy Modification in Identity and Cloud Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Conditional Access Policies technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [AWS IAM Conditions](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html)
- [GCP IAM Conditions](https://cloud.google.com/iam/docs/conditions-overview)
- [JumpCloud Conditional Access Policies](https://jumpcloud.com/support/get-started-conditional-access-policies)
- [Microsoft Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview)
- [Okta Conditional Access Policies](https://support.okta.com/help/s/article/Conditional-access-based-on-device-security-posture?language=en_US)
- [Atomic Red Team - T1556.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.009)
- [MITRE ATT&CK - T1556.009](https://attack.mitre.org/techniques/T1556/009)
