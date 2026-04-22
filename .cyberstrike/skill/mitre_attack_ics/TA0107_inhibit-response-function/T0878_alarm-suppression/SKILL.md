---
name: "T0878_alarm-suppression"
description: "Adversaries may target protection function alarms to prevent them from notifying operators of critical conditions."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0878
  - inhibit-response-function
technique_id: "T0878"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0878"
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

# T0878 Alarm Suppression

## High-Level Description

Adversaries may target protection function alarms to prevent them from notifying operators of critical conditions. Alarm messages may be a part of an overall reporting system and of particular interest for adversaries. Disruption of the alarm system does not imply the disruption of the reporting system as a whole.

A Secura presentation on targeting OT notes a dual fold goal for adversaries attempting alarm suppression: prevent outgoing alarms from being raised and prevent incoming alarms from being responded to. The method of suppression may greatly depend on the type of alarm in question: 

* An alarm raised by a protocol message 
* An alarm signaled with I/O 
* An alarm bit set in a flag (and read) 

In ICS environments, the adversary may have to suppress or contend with multiple alarms and/or alarm propagation to achieve a specific goal to evade detection or prevent intended responses from occurring. Methods of suppression may involve tampering or altering device displays and logs, modifying in memory code to fixed values, or even tampering with assembly level instruction code.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Alarm Suppression technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Alarm Suppression
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Alarm Suppression by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0878 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0814 Static Network Configuration
Unauthorized connections can be prevented by statically defining the hosts and ports used for automation protocol connections.

### M0807 Network Allowlists
Utilize network allowlists to restrict unnecessary connections to network devices (e.g., comm servers, serial to ethernet converters) and services, especially in cases when devices have limits on the number of simultaneous sessions they support.

### M0930 Network Segmentation
Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0810 Out-of-Band Communications Channel
Provide an alternative method for alarms to be reported in the event of a communication failure.


## Detection

### Detection of Alarm Suppression


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Alarm Suppression technique applicable | Low | Inhibit Response Function |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Jos Wetzels, Marina Krotofil 2019](https://troopers.de/downloads/troopers19/TROOPERS19_NGI_IoT_diet_poisoned_fruit.pdf)
- [MITRE ATT&CK ICS - T0878](https://attack.mitre.org/techniques/T0878)
