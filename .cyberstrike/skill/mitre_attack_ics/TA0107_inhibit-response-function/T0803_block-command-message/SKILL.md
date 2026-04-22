---
name: "T0803_block-command-message"
description: "Adversaries may block a command message from reaching its intended target to prevent command execution."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0803
  - inhibit-response-function
technique_id: "T0803"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0803"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0803 Block Command Message

## High-Level Description

Adversaries may block a command message from reaching its intended target to prevent command execution. In OT networks, command messages are sent to provide instructions to control system devices. A blocked command message can inhibit response functions from correcting a disruption or unsafe condition.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Block Command Message technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Block Command Message
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Block Command Message by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0803 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0810 Out-of-Band Communications Channel

Provide an alternative method for sending critical commands message to outstations, this could include using radio/cell communication to send messages to a field technician that physically performs the control function.

### M0807 Network Allowlists

Utilize network allowlists to restrict unnecessary connections to network devices (e.g., comm servers, serial to ethernet converters) and services, especially in cases when devices have limits on the number of simultaneous sessions they support.

### M0814 Static Network Configuration

Unauthorized connections can be prevented by statically defining the hosts and ports used for automation protocol connections.

## Detection

### Detection of Block Command Message

## Risk Assessment

| Finding                                    | Severity | Impact                    |
| ------------------------------------------ | -------- | ------------------------- |
| Block Command Message technique applicable | Low      | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Bonnie Zhu, Anthony Joseph, Shankar Sastry 2011](http://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6142258)
- [Electricity Information Sharing and Analysis Center; SANS Industrial Control Systems March 2016](https://assets.contentstack.io/v3/assets/blt36c2e63521272fdc/blt6a77276749b76a40/607f235992f0063e5c070fff/E-ISAC_SANS_Ukraine_DUC_5%5b73%5d.pdf)
- [MITRE ATT&CK ICS - T0803](https://attack.mitre.org/techniques/T0803)
