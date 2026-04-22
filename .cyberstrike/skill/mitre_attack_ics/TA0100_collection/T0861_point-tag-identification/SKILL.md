---
name: "T0861_point-tag-identification"
description: "Adversaries may collect point and tag values to gain a more comprehensive understanding of the process environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0861
  - collection
technique_id: "T0861"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0861"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0861 Point & Tag Identification

## High-Level Description

Adversaries may collect point and tag values to gain a more comprehensive understanding of the process environment. Points may be values such as inputs, memory locations, outputs or other process specific variables. Tags are the identifiers given to points for operator convenience.

Collecting such tags provides valuable context to environmental points and enables an adversary to map inputs, outputs, and other values to their control processes. Understanding the points being collected may inform an adversary on which processes and values to keep track of over the course of an operation.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Point & Tag Identification technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Point & Tag Identification
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Point & Tag Identification by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0861 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0800 Authorization Enforcement

Systems and devices should restrict access to any data with potential confidentiality concerns, including point and tag information.

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0937 Filter Network Traffic

Perform inline allowlisting of automation protocol commands to prevent devices from sending unauthorized command or reporting messages. Allow/denylist techniques need to be designed with sufficient accuracy to prevent the unintended blocking of valid messages.

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0813 Software Process and Device Authentication

Devices should authenticate all messages between master and outstation assets.

### M0801 Access Management

Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0930 Network Segmentation

Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0802 Communication Authenticity

Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).

## Detection

### Detection of Point & Tag Identification

## Risk Assessment

| Finding                                         | Severity | Impact     |
| ----------------------------------------------- | -------- | ---------- |
| Point & Tag Identification technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Dennis L. Sloatman September 2016](https://www.radioworld.com/industry/understanding-plc-programming-methods-and-the-tag-database-system)
- [MITRE ATT&CK ICS - T0861](https://attack.mitre.org/techniques/T0861)
