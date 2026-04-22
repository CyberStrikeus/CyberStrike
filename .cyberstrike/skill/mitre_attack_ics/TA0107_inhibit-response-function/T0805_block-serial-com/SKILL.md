---
name: "T0805_block-serial-com"
description: "Adversaries may block access to serial COM to prevent instructions or configurations from reaching target devices."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0805
  - inhibit-response-function
technique_id: "T0805"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0805"
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

# T0805 Block Serial COM

## High-Level Description

Adversaries may block access to serial COM to prevent instructions or configurations from reaching target devices. Serial Communication ports (COM) allow communication with control system devices. Devices can receive command and configuration messages over such serial COM. Devices also use serial COM to send command and reporting messages. Blocking device serial COM may also block command messages and block reporting messages. 

A serial to Ethernet converter is often connected to a serial COM to facilitate communication between serial and Ethernet devices. One approach to blocking a serial COM would be to create and hold open a TCP session with the Ethernet side of the converter. A serial to Ethernet converter may have a few ports open to facilitate multiple communications. For example, if there are three serial COM available -- 1, 2 and 3 --, the converter might be listening on the corresponding ports 20001, 20002, and 20003. If a TCP/IP connection is opened with one of these ports and held open, then the port will be unavailable for use by another party. One way the adversary could achieve this would be to initiate a TCP session with the serial to Ethernet converter at 10.0.0.1 via Telnet on serial port 1 with the following command: telnet 10.0.0.1 20001.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Block Serial COM technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Block Serial COM
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Block Serial COM by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0805 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0930 Network Segmentation
Restrict unauthorized devices from accessing serial comm ports.

### M0810 Out-of-Band Communications Channel
Ensure devices have an alternative method for communicating in the event that a valid COM port is unavailable.

### M0807 Network Allowlists
Implement network allowlists to minimize serial comm port access to only authorized hosts, such as comm servers and RTUs.


## Detection

### Detection of Block Serial COM


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Block Serial COM technique applicable | Low | Inhibit Response Function |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [MITRE ATT&CK ICS - T0805](https://attack.mitre.org/techniques/T0805)
