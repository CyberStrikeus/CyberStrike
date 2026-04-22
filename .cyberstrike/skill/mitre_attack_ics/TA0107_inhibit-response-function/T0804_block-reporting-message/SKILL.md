---
name: "T0804_block-reporting-message"
description: "Adversaries may block or prevent a reporting message from reaching its intended target."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0804
  - inhibit-response-function
technique_id: "T0804"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0804"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0804 Block Reporting Message

## High-Level Description

Adversaries may block or prevent a reporting message from reaching its intended target. In control systems, reporting messages contain telemetry data (e.g., I/O values) pertaining to the current state of equipment and the industrial process. By blocking these reporting messages, an adversary can potentially hide their actions from an operator.

Blocking reporting messages in control systems that manage physical processes may contribute to system impact, causing inhibition of a response function. A control system may not be able to respond in a proper or timely manner to an event, such as a dangerous fault, if its corresponding reporting message is blocked.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Block Reporting Message technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Block Reporting Message
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Block Reporting Message by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0804 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0814 Static Network Configuration

Unauthorized connections can be prevented by statically defining the hosts and ports used for automation protocol connections.

### M0810 Out-of-Band Communications Channel

Provide an alternative method for sending critical report messages to operators, this could include using radio/cell communication to obtain messages from field technicians that can locally obtain telemetry and status data.

### M0807 Network Allowlists

Utilize network allowlists to restrict unnecessary connections to network devices (e.g., comm servers, serial to ethernet converters) and services, especially in cases when devices have limits on the number of simultaneous sessions they support.

## Detection

### Detection of Block Reporting Message

## Risk Assessment

| Finding                                      | Severity | Impact                    |
| -------------------------------------------- | -------- | ------------------------- |
| Block Reporting Message technique applicable | Low      | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Bonnie Zhu, Anthony Joseph, Shankar Sastry 2011](http://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6142258)
- [Electricity Information Sharing and Analysis Center; SANS Industrial Control Systems March 2016](https://assets.contentstack.io/v3/assets/blt36c2e63521272fdc/blt6a77276749b76a40/607f235992f0063e5c070fff/E-ISAC_SANS_Ukraine_DUC_5%5b73%5d.pdf)
- [MITRE ATT&CK ICS - T0804](https://attack.mitre.org/techniques/T0804)
