---
name: "T0830_adversary-in-the-middle"
description: "Adversaries with privileged network access may seek to modify network traffic in real time using adversary-in-the-middle (AiTM) attacks."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0830
  - collection
technique_id: "T0830"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0830"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0830 Adversary-in-the-Middle

## High-Level Description

Adversaries with privileged network access may seek to modify network traffic in real time using adversary-in-the-middle (AiTM) attacks. This type of attack allows the adversary to intercept traffic to and/or from a particular device on the network. If a AiTM attack is established, then the adversary has the ability to block, log, modify, or inject traffic into the communication stream. There are several ways to accomplish this attack, but some of the most-common are Address Resolution Protocol (ARP) poisoning and the use of a proxy.

An AiTM attack may allow an adversary to perform the following attacks:
Block Reporting Message, Spoof Reporting Message, Modify Parameter, Unauthorized Command Message

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Adversary-in-the-Middle technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Adversary-in-the-Middle
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Adversary-in-the-Middle by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0830 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0930 Network Segmentation

Network segmentation can be used to isolate infrastructure components that do not require broad network access. This may mitigate, or at least alleviate, the scope of AiTM activity.

### M0810 Out-of-Band Communications Channel

Utilize out-of-band communication to validate the integrity of data from the primary channel.

### M0813 Software Process and Device Authentication

To protect against AiTM, authentication mechanisms should not send credentials across the network in plaintext and should also implement mechanisms to prevent replay attacks (such as nonces or timestamps). Challenge-response based authentication techniques that do not directly send credentials over the network provide better protection from AiTM.

### M0814 Static Network Configuration

Statically defined ARP entries can prevent manipulation and sniffing of switched network traffic, as some AiTM techniques depend on sending spoofed ARP messages to manipulate network host's dynamic ARP tables.

### M0931 Network Intrusion Prevention

Network intrusion detection and prevention systems that can identify traffic patterns indicative of AiTM activity can be used to mitigate activity at the network level.

### M0947 Audit

Limit access to network infrastructure and resources that can be used to reshape traffic or otherwise produce AiTM conditions.

### M0942 Disable or Remove Feature or Program

Disable unnecessary legacy network protocols that may be used for AiTM if applicable.

### M0802 Communication Authenticity

Communication authenticity will ensure that any messages tampered with through AiTM can be detected, but cannot prevent eavesdropping on these. In addition, providing communication authenticity around various discovery protocols, such as DNS, can be used to prevent various AiTM procedures.

## Detection

### Detection of Adversary-in-the-Middle

## Risk Assessment

| Finding                                      | Severity | Impact     |
| -------------------------------------------- | -------- | ---------- |
| Adversary-in-the-Middle technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Bonnie Zhu, Anthony Joseph, Shankar Sastry 2011](http://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6142258)
- [Gabriel Sanchez October 2017](https://www.sans.org/reading-room/whitepapers/ICS/man-in-the-middle-attack-modbus-tcp-illustrated-wireshark-38095)
- [MITRE ATT&CK ICS - T0830](https://attack.mitre.org/techniques/T0830)
