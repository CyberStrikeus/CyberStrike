---
name: "T0882_theft-of-operational-information"
description: "Adversaries may steal operational information on a production environment as a direct mission outcome for personal gain or to inform future operations."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0882
  - impact
technique_id: "T0882"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0882"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0882 Theft of Operational Information

## High-Level Description

Adversaries may steal operational information on a production environment as a direct mission outcome for personal gain or to inform future operations. This information may include design documents, schedules, rotational data, or similar artifacts that provide insight on operations. In the Bowman Dam incident, adversaries probed systems for operational data.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Theft of Operational Information technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Theft of Operational Information
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Theft of Operational Information by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0882 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0922 Restrict File and Directory Permissions

Protect files stored locally with proper permissions to limit opportunities for adversaries to interact and collect information from databases.

### M0809 Operational Information Confidentiality

Example mitigations could include minimizing its distribution/storage or obfuscating the information (e.g., facility coverterms, codenames). In many cases this information may be necessary to support critical engineering, maintenance, or operational functions, therefore, it may not be feasible to implement.

### M0803 Data Loss Prevention

Apply DLP to protect the confidentiality of information related to operational processes, facility locations, device configurations, programs, or databases that may have information that can be used to infer organizational trade-secrets, recipes, and other intellectual property (IP).

### M0941 Encrypt Sensitive Information

Encrypt any operational data with strong confidentiality requirements, including organizational trade-secrets, recipes, and other intellectual property (IP).

## Detection

### Detection of Theft of Operational Information

## Risk Assessment

| Finding                                               | Severity | Impact |
| ----------------------------------------------------- | -------- | ------ |
| Theft of Operational Information technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Mark Thompson March 2016](https://time.com/4270728/iran-cyber-attack-dam-fbi/)
- [Danny Yadron December 2015](https://www.wsj.com/articles/iranian-hackers-infiltrated-new-york-dam-in-2013-1450662559)
- [MITRE ATT&CK ICS - T0882](https://attack.mitre.org/techniques/T0882)
