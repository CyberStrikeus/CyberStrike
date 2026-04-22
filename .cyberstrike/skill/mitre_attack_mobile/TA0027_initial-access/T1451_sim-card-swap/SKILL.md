---
name: "T1451_sim-card-swap"
description: "Adversaries may gain access to mobile devices through transfers or swaps from victims’ phone numbers to adversary-controlled SIM cards and mobile devices."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1451
  - initial-access
  - android
  - ios
technique_id: "T1451"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1451"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1451 SIM Card Swap

## High-Level Description

Adversaries may gain access to mobile devices through transfers or swaps from victims’ phone numbers to adversary-controlled SIM cards and mobile devices.

The typical process is as follows:

1. Adversaries will first gather information about victims through Phishing, social engineering, data breaches, or other avenues.
2. Adversaries will then impersonate victims as they contact mobile carriers to request for the SIM swaps. For example, adversaries would provide victims’ name and address to mobile carriers; once authenticated, adversaries would request for victims’ phone numbers to be transferred to adversary-controlled SIM cards.
3. Once completed, victims will lose mobile data, such as text messages and phone calls, on their mobile devices. In turn, adversaries will receive mobile data that was intended for the victims.

Adversaries may use the intercepted SMS messages to log into online accounts that use SMS-based authentication. Specifically, adversaries may use SMS-based authentication to log into banking and/or cryptocurrency accounts, then transfer funds to adversary-controlled wallets.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if SIM Card Swap technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of SIM Card Swap
- [ ] Check iOS devices for indicators of SIM Card Swap
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to SIM Card Swap by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1451 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy

Enterprises should monitor for SIM card changes on the Enterprise Mobility Management (EMM) or the Mobile Device Management (MDM).

### M1011 User Guidance

The user should become familiar with social engineering tactics that ask for Personally Identifiable Information (PII). Additionally, the user should include the use of hardware tokens, biometrics, and other non-SMS based authentication mechanisms where possible. Finally, the user should enable SIM swapping protections offered by the mobile carrier, such as setting up a PIN or password to authorize any changes to the account.

## Detection

### Detection of SIM Card Swap

## Risk Assessment

| Finding                            | Severity | Impact         |
| ---------------------------------- | -------- | -------------- |
| SIM Card Swap technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [ATT SIM Swap Scams](https://www.research.att.com/sites/cyberaware/ni/blog/sim_swap.html)
- [Verizon SIM Swapping](https://www.verizon.com/about/account-security/sim-swapping)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-22.html)
- [MITRE ATT&CK Mobile - T1451](https://attack.mitre.org/techniques/T1451)
