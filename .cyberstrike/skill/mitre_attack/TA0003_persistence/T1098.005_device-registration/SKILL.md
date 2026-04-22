---
name: "T1098.005_device-registration"
description: "Adversaries may register a device to an adversary-controlled account."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.005
  - persistence
  - privilege-escalation
  - windows
  - identity-provider
  - sub-technique
technique_id: "T1098.005"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1098/005"
tech_stack:
  - windows
  - identity
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.002
  - T1098.003
  - T1098.004
  - T1098.006
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
---

# T1098.005 Device Registration

> **Sub-technique of:** T1098

## High-Level Description

Adversaries may register a device to an adversary-controlled account. Devices may be registered in a multifactor authentication (MFA) system, which handles authentication to the network, or in a device management system, which handles device access and compliance.

MFA systems, such as Duo or Okta, allow users to associate devices with their accounts in order to complete MFA requirements. An adversary that compromises a user’s credentials may enroll a new device in order to bypass initial MFA requirements and gain persistent access to a network. In some cases, the MFA self-enrollment process may require only a username and password to enroll the account's first device or to enroll a device to an inactive account. 

Similarly, an adversary with existing access to a network may register a device or a virtual machine to Entra ID and/or its device management system, Microsoft Intune, in order to access sensitive data or resources while bypassing conditional access policies.

Devices registered in Entra ID may be able to conduct Internal Spearphishing campaigns via intra-organizational emails, which are less likely to be treated as suspicious by the email client. Additionally, an adversary may be able to perform a Service Exhaustion Flood on an Entra ID tenant by registering a large number of devices.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, Identity Provider

## What to Check

- [ ] Identify if Device Registration technique is applicable to target environment
- [ ] Check Windows systems for indicators of Device Registration
- [ ] Check Identity Provider systems for indicators of Device Registration
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Device Registration by examining the target platforms (Windows, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Require multi-factor authentication to register devices in Entra ID. Configure multi-factor authentication systems to disallow enrolling new devices for inactive accounts. When first enrolling MFA, use conditional access policies to restrict device enrollment to trusted locations or devices, and consider using temporary access passes as an initial MFA solution to enroll a device.


## Detection

### Suspicious Device Registration via Entra ID or MFA Platform


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Device Registration technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Expel Atlas Lion 2025](https://expel.com/blog/observing-atlas-lion-part-one/)
- [CISA MFA PrintNightmare](https://www.cisa.gov/uscert/ncas/alerts/aa22-074a)
- [Mandiant APT29 Microsoft 365 2022](https://www.mandiant.com/resources/blog/apt29-continues-targeting-microsoft)
- [AADInternals - Conditional Access Bypass](https://o365blog.com/post/mdm)
- [AADInternals - BPRT](https://o365blog.com/post/bprt/)
- [AADInternals - Device Registration](https://o365blog.com/post/devices/)
- [DarkReading FireEye SolarWinds](https://www.darkreading.com/threat-intelligence/fireeye-s-mandia-severity-zero-alert-led-to-discovery-of-solarwinds-attack)
- [Microsoft - Device Registration](https://www.microsoft.com/security/blog/2022/01/26/evolved-phishing-device-registration-trick-adds-to-phishers-toolbox-for-victims-without-mfa)
- [Microsoft DEV-0537](https://www.microsoft.com/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)
- [Atomic Red Team - T1098.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.005)
- [MITRE ATT&CK - T1098.005](https://attack.mitre.org/techniques/T1098/005)
