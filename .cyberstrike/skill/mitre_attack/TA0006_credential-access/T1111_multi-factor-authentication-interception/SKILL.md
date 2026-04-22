---
name: "T1111_multi-factor-authentication-interception"
description: "Adversaries may target multi-factor authentication (MFA) mechanisms, (i.e., smart cards, token generators, etc.) to gain access to credentials that can be used to access systems, services, and netw..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1111
  - credential-access
  - linux
  - windows
  - macos
technique_id: "T1111"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1111"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-522
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1111 Multi-Factor Authentication Interception

## High-Level Description

Adversaries may target multi-factor authentication (MFA) mechanisms, (i.e., smart cards, token generators, etc.) to gain access to credentials that can be used to access systems, services, and network resources. Use of MFA is recommended and provides a higher level of security than usernames and passwords alone, but organizations should be aware of techniques that could be used to intercept and bypass these security mechanisms. 

If a smart card is used for multi-factor authentication, then a keylogger will need to be used to obtain the password associated with a smart card during normal use. With both an inserted card and access to the smart card password, an adversary can connect to a network resource using the infected system to proxy the authentication with the inserted hardware token. 

Adversaries may also employ a keylogger to similarly target other hardware tokens, such as RSA SecurID. Capturing token input (including a user's personal identification code) may provide temporary access (i.e. replay the one-time passcode until the next value rollover) as well as possibly enabling adversaries to reliably predict future authentication values (given access to both the algorithm and any seed values used to generate appended temporary codes). 

Other methods of MFA may be intercepted and used by an adversary to authenticate. It is common for one-time codes to be sent via out-of-band communications (email, SMS). If the device and/or service is not secured, then it may be vulnerable to interception. Service providers can also be targeted: for example, an adversary may compromise an SMS messaging service in order to steal MFA codes sent to users’ phones.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Multi-Factor Authentication Interception technique is applicable to target environment
- [ ] Check Linux systems for indicators of Multi-Factor Authentication Interception
- [ ] Check Windows systems for indicators of Multi-Factor Authentication Interception
- [ ] Check macOS systems for indicators of Multi-Factor Authentication Interception
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Multi-Factor Authentication Interception by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1111 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Remove smart cards when not in use.


## Detection

### Detection Strategy for MFA Interception via Input Capture and Smart Card Proxying


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Multi-Factor Authentication Interception technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [GCN RSA June 2011](https://www.route-fifty.com/cybersecurity/2011/06/rsa-confirms-its-tokens-used-in-lockheed-hack/282818/)
- [Mandiant M Trends 2011](https://dl.mandiant.com/EE/assets/PDF_MTrends_2011.pdf)
- [Okta Scatter Swine 2022](https://sec.okta.com/scatterswine)
- [Atomic Red Team - T1111](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1111)
- [MITRE ATT&CK - T1111](https://attack.mitre.org/techniques/T1111)
