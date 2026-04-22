---
name: "T1496.004_cloud-service-hijacking"
description: "Adversaries may leverage compromised software-as-a-service (SaaS) applications to complete resource-intensive tasks, which may impact hosted service availability."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1496.004
  - impact
  - saas
  - sub-technique
technique_id: "T1496.004"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1496/004"
tech_stack:
  - saas
cwe_ids:
  - CWE-400
chains_with:
  - T1496
  - T1496.001
  - T1496.002
  - T1496.003
prerequisites:
  - T1496
severity_boost:
  T1496: "Chain with T1496 for deeper attack path"
  T1496.001: "Chain with T1496.001 for deeper attack path"
  T1496.002: "Chain with T1496.002 for deeper attack path"
---

# T1496.004 Cloud Service Hijacking

> **Sub-technique of:** T1496

## High-Level Description

Adversaries may leverage compromised software-as-a-service (SaaS) applications to complete resource-intensive tasks, which may impact hosted service availability. 

For example, adversaries may leverage email and messaging services, such as AWS Simple Email Service (SES), AWS Simple Notification Service (SNS), SendGrid, and Twilio, in order to send large quantities of spam / Phishing emails and SMS messages. Alternatively, they may engage in LLMJacking by leveraging reverse proxies to hijack the power of cloud-hosted AI models.

In some cases, adversaries may leverage services that the victim is already using. In others, particularly when the service is part of a larger cloud platform, they may first enable the service. Leveraging SaaS applications may cause the victim to incur significant financial costs, use up service quotas, and otherwise impact availability.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** SaaS

## What to Check

- [ ] Identify if Cloud Service Hijacking technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Cloud Service Hijacking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Service Hijacking by examining the target platforms (SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1496.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Cloud Service Hijacking via SaaS Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cloud Service Hijacking technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [SentinelLabs SNS Sender 2024](https://www.sentinelone.com/labs/sns-sender-active-campaigns-unleash-messaging-spam-through-the-cloud/)
- [Invictus IR DangerDev 2024](https://www.invictus-ir.com/news/the-curious-case-of-dangerdev-protonmail-me)
- [Lacework LLMJacking 2024](https://www.lacework.com/blog/detecting-ai-resource-hijacking-with-composite-alerts)
- [Sysdig LLMJacking 2024](https://sysdig.com/blog/llmjacking-stolen-cloud-credentials-used-in-new-ai-attack/)
- [Permiso SES Abuse 2023](https://permiso.io/blog/s/aws-ses-pionage-detecting-ses-abuse/)
- [Atomic Red Team - T1496.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1496.004)
- [MITRE ATT&CK - T1496.004](https://attack.mitre.org/techniques/T1496/004)
