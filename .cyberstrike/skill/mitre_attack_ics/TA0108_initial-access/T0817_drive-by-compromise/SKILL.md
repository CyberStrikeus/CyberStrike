---
name: "T0817_drive-by-compromise"
description: "Adversaries may gain access to a system during a drive-by compromise, when a user visits a website as part of a regular browsing session."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0817
  - initial-access
technique_id: "T0817"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0817"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0817 Drive-by Compromise

## High-Level Description

Adversaries may gain access to a system during a drive-by compromise, when a user visits a website as part of a regular browsing session. With this technique, the user's web browser is targeted and exploited simply by visiting the compromised website. 

The adversary may target a specific community, such as trusted third party suppliers or other industry specific groups, which often visit the target website. This kind of targeted attack relies on a common interest, and is known as a strategic web compromise or watering hole attack. 

The National Cyber Awareness System (NCAS) has issued a Technical Alert (TA) regarding Russian government cyber activity targeting critical infrastructure sectors. Analysis by DHS and FBI has noted two distinct categories of victims in the Dragonfly campaign on the Western energy sector: staging and intended targets. The adversary targeted the less secure networks of staging targets, including trusted third-party suppliers and related peripheral organizations. Initial access to the intended targets used watering hole attacks to target process control, ICS, and critical infrastructure related trade publications and informational websites.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Drive-by Compromise technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Drive-by Compromise
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Drive-by Compromise by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0817 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0951 Update Software
Ensure all browsers and plugins are kept updated to help prevent the exploit phase of this technique. Use modern browsers with security features enabled.

### M0948 Application Isolation and Sandboxing
Built-in browser sandboxes and application isolation may be used to contain web-based malware.

### M0950 Exploit Protection
Utilize exploit protection to prevent activities which may be exploited through malicious web sites.

### M0921 Restrict Web-Based Content
Restrict browsers to limit the capabilities of malicious ads and Javascript.


## Detection

### Detection of Drive-by Compromise


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Drive-by Compromise technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Cybersecurity & Infrastructure Security Agency March 2018](https://us-cert.cisa.gov/ncas/alerts/TA18-074A)
- [MITRE ATT&CK ICS - T0817](https://attack.mitre.org/techniques/T0817)
