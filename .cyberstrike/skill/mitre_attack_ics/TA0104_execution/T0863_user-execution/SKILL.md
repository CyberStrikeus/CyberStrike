---
name: "T0863_user-execution"
description: "Adversaries may rely on a targeted organizations user interaction for the execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0863
  - execution
technique_id: "T0863"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0863"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0863 User Execution

## High-Level Description

Adversaries may rely on a targeted organizations user interaction for the execution of malicious code. User interaction may consist of installing applications, opening email attachments, or granting higher permissions to documents.

Adversaries may embed malicious code or visual basic code into files such as Microsoft Word and Excel documents or software installers. Execution of this code requires that the user enable scripting or write access within the document. Embedded code may not always be noticeable to the user especially in cases of trojanized software.

A Chinese spearphishing campaign running from December 9, 2011 through February 29, 2012 delivered malware through spearphishing attachments which required user action to achieve execution.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if User Execution technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of User Execution
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to User Execution by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0863 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0938 Execution Prevention

Application control may be able to prevent the running of executables masquerading as other files.

### M0921 Restrict Web-Based Content

If a link is being visited by a user, block unknown or unused files in transit by default that should not be downloaded or by policy from suspicious sites as a best practice to prevent some vectors, such as .scr, .exe, .pif, .cpl, etc. Some download scanning devices can open and analyze compressed and encrypted formats, such as zip and rar that may be used to conceal malicious files.

### M0917 User Training

Use user training as a way to bring awareness to common phishing and spearphishing techniques and how to raise suspicion for potentially malicious events.

### M0931 Network Intrusion Prevention

If a link is being visited by a user, network intrusion prevention systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M0949 Antivirus/Antimalware

Ensure anti-virus solution can detect malicious files that allow user execution (e.g., Microsoft Office Macros, program installers).

### M0945 Code Signing

Prevent the use of unsigned executables, such as installers and scripts.

## Detection

### Detection of User Execution

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| User Execution technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Booz Allen Hamilton](https://www.boozallen.com/content/dam/boozallen/documents/2016/09/ukraine-report-when-the-lights-went-out.pdf)
- [Daavid Hentunen, Antti Tikkanen June 2014](https://www.f-secure.com/weblog/archives/00002718.html)
- [CISA AA21-201A Pipeline Intrusion July 2021](<https://us-cert.cisa.gov/sites/default/files/publications/AA21-201A_Chinese_Gas_Pipeline_Intrusion_Campaign_2011_to_2013%20(1).pdf>)
- [MITRE ATT&CK ICS - T0863](https://attack.mitre.org/techniques/T0863)
