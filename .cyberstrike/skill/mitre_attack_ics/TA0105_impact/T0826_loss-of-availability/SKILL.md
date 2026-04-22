---
name: "T0826_loss-of-availability"
description: "Adversaries may attempt to disrupt essential components or systems to prevent owner and operator from delivering products or services."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0826
  - impact
technique_id: "T0826"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0826"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0826 Loss of Availability

## High-Level Description

Adversaries may attempt to disrupt essential components or systems to prevent owner and operator from delivering products or services.

Adversaries may leverage malware to delete or encrypt critical data on HMIs, workstations, or databases.

In the 2021 Colonial Pipeline ransomware incident, pipeline operations were temporally halted on May 7th and were not fully restarted until May 12th.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Loss of Availability technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Loss of Availability
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Loss of Availability by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0826 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0810 Out-of-Band Communications Channel

Provide operators with redundant, out-of-band communication to support monitoring and control of the operational processes, especially when recovering from a network outage . Out-of-band communication should utilize diverse systems and technologies to minimize common failure modes and vulnerabilities within the communications infrastructure. For example, wireless networks (e.g., 3G, 4G) can be used to provide diverse and redundant delivery of data.

### M0811 Redundancy of Service

Hot-standbys in diverse locations can ensure continued operations if the primarily system is compromised or unavailable. At the network layer, protocols such as the Parallel Redundancy Protocol can be used to simultaneously use redundant and diverse communication over a local network.

### M0953 Data Backup

Take and store data backups from end user systems and critical servers. Ensure backup and storage systems are hardened and kept separate from the corporate network to prevent compromise. Maintain and exercise incident response plans , including the management of gold-copy back-up images and configurations for key systems to enable quick recovery and response from adversarial activities that impact control, view, or availability.

## Detection

### Detection of Loss of Availability

## Risk Assessment

| Finding                                   | Severity | Impact |
| ----------------------------------------- | -------- | ------ |
| Loss of Availability technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Colonial Pipeline Company May 2021](https://www.colpipe.com/news/press-releases/media-statement-colonial-pipeline-system-disruption)
- [Corero](https://www.corero.com/resources/files/whitepapers/cns_whitepaper_ics.pdf)
- [Michael J. Assante and Robert M. Lee](https://icscsi.org/library/Documents/White_Papers/SANS%20-%20ICS%20Cyber%20Kill%20Chain.pdf)
- [Tyson Macaulay](https://books.google.com/books?id=oXIYBAAAQBAJ&pg=PA249&lpg=PA249&dq=loss+denial+manipulation+of+view&source=bl&ots=dV1uQ8IUff&sig=ACfU3U2NIwGjhg051D_Ytw6npyEk9xcf4w&hl=en&sa=X&ved=2ahUKEwj2wJ7y4tDlAhVmplkKHSTaDnQQ6AEwAHoECAgQAQ#v=onepage&q=loss%20denial%20manipulation%20of%20view&f=false)
- [MITRE ATT&CK ICS - T0826](https://attack.mitre.org/techniques/T0826)
