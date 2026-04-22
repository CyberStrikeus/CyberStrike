---
name: "T0865_spearphishing-attachment"
description: "Adversaries may use a spearphishing attachment, a variant of spearphishing, as a form of a social engineering attack against specific targets."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0865
  - initial-access
technique_id: "T0865"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0865"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0865 Spearphishing Attachment

## High-Level Description

Adversaries may use a spearphishing attachment, a variant of spearphishing, as a form of a social engineering attack against specific targets. Spearphishing attachments are different from other forms of spearphishing in that they employ malware attached to an email. All forms of spearphishing are electronically delivered and target a specific individual, company, or industry. In this scenario, adversaries attach a file to the spearphishing email and usually rely upon User Execution to gain execution and access.

A Chinese spearphishing campaign running from December 9, 2011 through February 29, 2012, targeted ONG organizations and their employees. The emails were constructed with a high level of sophistication to convince employees to open the malicious file attachments.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Spearphishing Attachment technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Spearphishing Attachment
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Spearphishing Attachment by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0865 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0917 User Training

Users can be trained to identify social engineering techniques and spearphishing emails.

### M0931 Network Intrusion Prevention

Network intrusion prevention systems and systems designed to scan and remove malicious email attachments can be used to block activity.

### M0949 Antivirus/Antimalware

Deploy anti-virus on all systems that support external email.

### M0921 Restrict Web-Based Content

Consider restricting access to email within critical process environments. Additionally, downloads and attachments may be disabled if email is still necessary.

## Detection

### Detection of Spearphishing Attachment

## Risk Assessment

| Finding                                       | Severity | Impact         |
| --------------------------------------------- | -------- | -------------- |
| Spearphishing Attachment technique applicable | Low      | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [CISA AA21-201A Pipeline Intrusion July 2021](<https://us-cert.cisa.gov/sites/default/files/publications/AA21-201A_Chinese_Gas_Pipeline_Intrusion_Campaign_2011_to_2013%20(1).pdf>)
- [Enterprise ATT&CK October 2019](https://attack.mitre.org/techniques/T1193/)
- [MITRE ATT&CK ICS - T0865](https://attack.mitre.org/techniques/T0865)
