---
name: "T0827_loss-of-control"
description: "Adversaries may seek to achieve a sustained loss of control or a runaway condition in which operators cannot issue any commands even if the malicious interference has subsided."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0827
  - impact
technique_id: "T0827"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0827"
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

# T0827 Loss of Control

## High-Level Description

Adversaries may seek to achieve a sustained loss of control or a runaway condition in which operators cannot issue any commands even if the malicious interference has subsided. 

The German Federal Office for Information Security (BSI) reported a targeted attack on a steel mill in its 2014 IT Security Report. These targeted attacks affected industrial operations and resulted in breakdowns of control system components and even entire installations. As a result of these breakdowns, massive impact resulted in damage and unsafe conditions from the uncontrolled shutdown of a blast furnace.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Loss of Control technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Loss of Control
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Loss of Control by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0827 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0953 Data Backup
Take and store data backups from end user systems and critical servers. Ensure backup and storage systems are hardened and kept separate from the corporate network to prevent compromise. Maintain and exercise incident response plans , including the management of gold-copy back-up images and configurations for key systems to enable quick recovery and response from adversarial activities that impact control, view, or availability.

### M0811 Redundancy of Service
Hot-standbys in diverse locations can ensure continued operations if the primarily system are compromised or unavailable. At the network layer, protocols such as the Parallel Redundancy Protocol can be used to simultaneously use redundant and diverse communication over a local network.

### M0810 Out-of-Band Communications Channel
Provide operators with redundant, out-of-band communication to support monitoring and control of the operational processes, especially when recovering from a network outage . Out-of-band communication should utilize diverse systems and technologies to minimize common failure modes and vulnerabilities within the communications infrastructure. For example, wireless networks (e.g., 3G, 4G) can be used to provide diverse and redundant delivery of data.


## Detection

### Detection of Loss of Control


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Loss of Control technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [BSI State of IT Security 2014](https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/Securitysituation/IT-Security-Situation-in-Germany-2014.pdf?__blob=publicationFile&v=3)
- [Corero](https://www.corero.com/resources/files/whitepapers/cns_whitepaper_ics.pdf)
- [Michael J. Assante and Robert M. Lee](https://icscsi.org/library/Documents/White_Papers/SANS%20-%20ICS%20Cyber%20Kill%20Chain.pdf)
- [Tyson Macaulay](https://books.google.com/books?id=oXIYBAAAQBAJ&pg=PA249&lpg=PA249&dq=loss+denial+manipulation+of+view&source=bl&ots=dV1uQ8IUff&sig=ACfU3U2NIwGjhg051D_Ytw6npyEk9xcf4w&hl=en&sa=X&ved=2ahUKEwj2wJ7y4tDlAhVmplkKHSTaDnQQ6AEwAHoECAgQAQ#v=onepage&q=loss%20denial%20manipulation%20of%20view&f=false)
- [MITRE ATT&CK ICS - T0827](https://attack.mitre.org/techniques/T0827)
