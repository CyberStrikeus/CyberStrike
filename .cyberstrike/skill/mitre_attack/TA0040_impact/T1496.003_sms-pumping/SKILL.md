---
name: "T1496.003_sms-pumping"
description: "Adversaries may leverage messaging services for SMS pumping, which may impact system and/or hosted service availability."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1496.003
  - impact
  - saas
  - sub-technique
technique_id: "T1496.003"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1496/003"
tech_stack:
  - saas
cwe_ids:
  - CWE-400
chains_with:
  - T1496
  - T1496.001
  - T1496.002
  - T1496.004
prerequisites:
  - T1496
severity_boost:
  T1496: "Chain with T1496 for deeper attack path"
  T1496.001: "Chain with T1496.001 for deeper attack path"
  T1496.002: "Chain with T1496.002 for deeper attack path"
---

# T1496.003 SMS Pumping

> **Sub-technique of:** T1496

## High-Level Description

Adversaries may leverage messaging services for SMS pumping, which may impact system and/or hosted service availability. SMS pumping is a type of telecommunications fraud whereby a threat actor first obtains a set of phone numbers from a telecommunications provider, then leverages a victim’s messaging infrastructure to send large amounts of SMS messages to numbers in that set. By generating SMS traffic to their phone number set, a threat actor may earn payments from the telecommunications provider.

Threat actors often use publicly available web forms, such as one-time password (OTP) or account verification fields, in order to generate SMS traffic. These fields may leverage services such as Twilio, AWS SNS, and Amazon Cognito in the background. In response to the large quantity of requests, SMS costs may increase and communication channels may become overwhelmed.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** SaaS

## What to Check

- [ ] Identify if SMS Pumping technique is applicable to target environment
- [ ] Check SaaS systems for indicators of SMS Pumping
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SMS Pumping by examining the target platforms (SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1496.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1013 Application Developer Guidance
Consider implementing CAPTCHA protection on forms that send messages via SMS.


## Detection

### Detection Strategy for Resource Hijacking: SMS Pumping via SaaS Application Logs


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SMS Pumping technique applicable | Low | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [AWS RE:Inforce Threat Detection 2024](https://reinforce.awsevents.com/content/dam/reinforce/2024/slides/TDR432_New-tactics-and-techniques-for-proactive-threat-detection.pdf)
- [Twilio SMS Pumping](https://www.twilio.com/en-us/blog/sms-pumping-fraud-solutions)
- [Twilio SMS Pumping Fraud](https://www.twilio.com/docs/glossary/what-is-sms-pumping-fraud)
- [Atomic Red Team - T1496.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1496.003)
- [MITRE ATT&CK - T1496.003](https://attack.mitre.org/techniques/T1496/003)
