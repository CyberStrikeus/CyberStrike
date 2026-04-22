---
name: "T0828_loss-of-productivity-and-revenue"
description: "Adversaries may cause loss of productivity and revenue through disruption and even damage to the availability and integrity of control system operations, devices, and related processes."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0828
  - impact
technique_id: "T0828"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0828"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0828 Loss of Productivity and Revenue

## High-Level Description

Adversaries may cause loss of productivity and revenue through disruption and even damage to the availability and integrity of control system operations, devices, and related processes. This technique may manifest as a direct effect of an ICS-targeting attack or tangentially, due to an IT-targeting attack against non-segregated environments. 

In cases where these operations or services are brought to a halt, the loss of productivity may eventually present an impact for the end-users or consumers of products and services. The disrupted supply-chain may result in supply shortages and increased prices, among other consequences. 

A ransomware attack on an Australian beverage company resulted in the shutdown of some manufacturing sites, including precautionary halts to protect key systems. The company announced the potential for temporary shortages of their products following the attack. 

In the 2021 Colonial Pipeline ransomware incident, the pipeline was unable to transport approximately 2.5 million barrels of fuel per day to the East Coast.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Loss of Productivity and Revenue technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Loss of Productivity and Revenue
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Loss of Productivity and Revenue by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0828 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0953 Data Backup
Take and store data backups from end user systems and critical servers. Ensure backup and storage systems are hardened and kept separate from the corporate network to prevent compromise. Maintain and exercise incident response plans , including the management of gold-copy back-up images and configurations for key systems to enable quick recovery and response from adversarial activities that impact control, view, or availability.


## Detection

### Detection of Loss of Productivity and Revenue


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Loss of Productivity and Revenue technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Colonial Pipeline Company May 2021](https://www.colpipe.com/news/press-releases/media-statement-colonial-pipeline-system-disruption)
- [Lion Corporation June 2020](https://lionco.com/2020/06/26/lion-update-re-cyber-issue/)
- [Paganini, Pierluigi June 2020](https://securityaffairs.co/wordpress/104749/cyber-crime/ransomware-attack-hit-lion.html)
- [MITRE ATT&CK ICS - T0828](https://attack.mitre.org/techniques/T0828)
