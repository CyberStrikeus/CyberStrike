---
name: "T1657_financial-theft"
description: "Adversaries may steal monetary resources from targets through extortion, social engineering, technical theft, or other methods aimed at their own financial gain at the expense of the availability o..."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1657
  - impact
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1657"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1657"
tech_stack:
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1657 Financial Theft

## High-Level Description

Adversaries may steal monetary resources from targets through extortion, social engineering, technical theft, or other methods aimed at their own financial gain at the expense of the availability of these resources for victims. Financial theft is the ultimate objective of several popular campaign types including extortion by ransomware, business email compromise (BEC) and fraud, "pig butchering," bank hacking, and exploiting cryptocurrency networks.

Adversaries may Compromise Accounts to conduct unauthorized transfers of funds. In the case of business email compromise or email fraud, an adversary may utilize Impersonation of a trusted entity. Once the social engineering is successful, victims can be deceived into sending money to financial accounts controlled by an adversary. This creates the potential for multiple victims (i.e., compromised accounts as well as the ultimate monetary loss) in incidents involving financial theft.

Extortion by ransomware may occur, for example, when an adversary demands payment from a victim after Data Encrypted for Impact and Exfiltration of data, followed by threatening to leak sensitive data to the public unless payment is made to the adversary. Adversaries may use dedicated leak sites to distribute victim data.

Due to the potentially immense business impact of financial theft, an adversary may abuse the possibility of financial theft and seeking monetary gain to divert attention from their true goals such as Data Destruction and business disruption.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Financial Theft technique is applicable to target environment
- [ ] Check Linux systems for indicators of Financial Theft
- [ ] Check macOS systems for indicators of Financial Theft
- [ ] Check Office Suite systems for indicators of Financial Theft
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Financial Theft by examining the target platforms (Linux, macOS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1657 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Train and encourage users to identify social engineering techniques used to enable financial theft. Also consider training users on procedures to prevent and respond to swatting and doxing, acts increasingly deployed by financially motivated groups to further coerce victims into satisfying ransom/extortion demands.

### M1018 User Account Management

Limit access/authority to execute sensitive transactions, and switch to systems and procedures designed to authenticate/approve payments and purchase requests outside of insecure communication lines such as email.

## Detection

### Detection Strategy for Financial Theft

## Risk Assessment

| Finding                              | Severity | Impact |
| ------------------------------------ | -------- | ------ |
| Financial Theft technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [VEC](https://www.cloudflare.com/learning/email-security/what-is-vendor-email-compromise/#:~:text=Vendor%20email%20compromise%2C%20also%20referred,steal%20from%20that%20vendor%27s%20customers.)
- [Crowdstrike-leaks](https://www.crowdstrike.com/blog/double-trouble-ransomware-data-leak-extortion-part-1/)
- [Mandiant-leaks](https://www.mandiant.com/resources/blog/ransomware-extortion-ot-docs)
- [DOJ-DPRK Heist](https://www.justice.gov/usao-cdca/pr/3-north-korean-military-hackers-indicted-wide-ranging-scheme-commit-cyber-attacks-and)
- [FBI-BEC](https://www.fbi.gov/file-repository/fy-2022-fbi-congressional-report-business-email-compromise-and-real-estate-wire-fraud-111422.pdf/view)
- [FBI-ransomware](https://www.cisa.gov/sites/default/files/Ransomware_Trifold_e-version.pdf)
- [AP-NotPetya](https://apnews.com/article/russia-ukraine-technology-business-europe-hacking-ce7a8aca506742ab8e8873e7f9f229c2)
- [Internet crime report 2022](https://www.ic3.gov/Media/PDF/AnnualReport/2022_IC3Report.pdf)
- [BBC-Ronin](https://www.bbc.com/news/technology-60933174)
- [wired-pig butchering](https://www.wired.com/story/pig-butchering-fbi-ic3-2022-report/)
- [NYT-Colonial](https://www.nytimes.com/2021/05/13/technology/colonial-pipeline-ransom.html)
- [Atomic Red Team - T1657](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1657)
- [MITRE ATT&CK - T1657](https://attack.mitre.org/techniques/T1657)
