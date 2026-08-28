---
name: "T1621_multi-factor-authentication-request-generation"
description: "Adversaries may attempt to bypass multi-factor authentication (MFA) mechanisms and gain access to accounts by generating MFA requests sent to users."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1621
  - credential-access
  - windows
  - linux
  - macos
  - iaas
  - saas
  - office-suite
  - identity-provider
technique_id: "T1621"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
  - Linux
  - macOS
  - IaaS
  - SaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1621"
tech_stack:
  - windows
  - linux
  - macos
  - cloud
  - saas
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1621 Multi-Factor Authentication Request Generation

## High-Level Description

Adversaries may attempt to bypass multi-factor authentication (MFA) mechanisms and gain access to accounts by generating MFA requests sent to users.

Adversaries in possession of credentials to Valid Accounts may be unable to complete the login process if they lack access to the 2FA or MFA mechanisms required as an additional credential and security control. To circumvent this, adversaries may abuse the automatic generation of push notifications to MFA services such as Duo Push, Microsoft Authenticator, Okta, or similar services to have the user grant access to their account. If adversaries lack credentials to victim accounts, they may also abuse automatic push notification generation when this option is configured for self-service password reset (SSPR).

In some cases, adversaries may continuously repeat login attempts in order to bombard users with MFA push notifications, SMS messages, and phone calls, potentially resulting in the user finally accepting the authentication request in response to “MFA fatigue.”

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, Linux, macOS, IaaS, SaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Multi-Factor Authentication Request Generation technique is applicable to target environment
- [ ] Check Windows systems for indicators of Multi-Factor Authentication Request Generation
- [ ] Check Linux systems for indicators of Multi-Factor Authentication Request Generation
- [ ] Check macOS systems for indicators of Multi-Factor Authentication Request Generation
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Multi-Factor Authentication Request Generation by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1621 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Implement more secure 2FA/MFA mechanisms in replacement of simple push or one-click 2FA/MFA options. For example, having users enter a one-time code provided by the login screen into the 2FA/MFA application or utilizing other out-of-band 2FA/MFA mechanisms (such as rotating code-based hardware tokens providing rotating codes that need an accompanying user pin) may be more secure. Furthermore, change default configurations and implement limits upon the maximum number of 2FA/MFA request prompts that can be sent to users in period of time.

### M1036 Account Use Policies

Enable account restrictions to prevent login attempts, and the subsequent 2FA/MFA service requests, from being initiated from suspicious locations or when the source of the login attempts do not match the location of the 2FA/MFA smart device. Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges.

### M1017 User Training

Train users to only accept 2FA/MFA requests from login attempts they initiated, to review source location of the login attempt prompting the 2FA/MFA requests, and to report suspicious/unsolicited prompts.

## Detection

### Detection Strategy for Multi-Factor Authentication Request Generation (T1621)

## Risk Assessment

| Finding                                                             | Severity | Impact            |
| ------------------------------------------------------------------- | -------- | ----------------- |
| Multi-Factor Authentication Request Generation technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Russian 2FA Push Annoyance - Cimpanu](https://therecord.media/russian-hackers-bypass-2fa-by-annoying-victims-with-repeated-push-notifications/)
- [MFA Fatigue Attacks - PortSwigger](https://portswigger.net/daily-swig/mfa-fatigue-attacks-users-tricked-into-allowing-device-access-due-to-overload-of-push-notifications)
- [Suspected Russian Activity Targeting Government and Business Entities Around the Globe](https://www.mandiant.com/resources/russian-targeting-gov-business)
- [Obsidian SSPR Abuse 2023](https://www.obsidiansecurity.com/blog/behind-the-breach-self-service-password-reset-azure-ad/)
- [Atomic Red Team - T1621](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1621)
- [MITRE ATT&CK - T1621](https://attack.mitre.org/techniques/T1621)
