---
name: "T0843_program-download"
description: "Adversaries may perform a program download to transfer a user program to a controller."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0843
  - lateral-movement
technique_id: "T0843"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0843"
tech_stack:
  - ics
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0843 Program Download

## High-Level Description

Adversaries may perform a program download to transfer a user program to a controller.

Variations of program download, such as online edit and program append, allow a controller to continue running during the transfer and reconfiguration process without interruption to process control. However, before starting a full program download (i.e., download all) a controller may need to go into a stop state. This can have negative consequences on the physical process, especially if the controller is not able to fulfill a time-sensitive action. Adversaries may choose to avoid a download all in favor of an online edit or program append to avoid disrupting the physical process. An adversary may need to use the technique Detect Operating Mode or Change Operating Mode to make sure the controller is in the proper mode to accept a program download.

The granularity of control to transfer a user program in whole or parts is dictated by the management protocol (e.g., S7CommPlus, TriStation) and underlying controller API. Thus, program download is a high-level term for the suite of vendor-specific API calls used to configure a controllers user program memory space.

Modify Controller Tasking and Modify Program represent the configuration changes that are transferred to a controller via a program download.

## Kill Chain Phase

- Lateral Movement (TA0109)

**Platforms:** ICS

## What to Check

- [ ] Identify if Program Download technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Program Download
- [ ] Verify mitigations are bypassed or absent (10 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Program Download by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0843 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication

Authenticate connections from software and devices to prevent unauthorized systems from accessing protected management functions.

### M0947 Audit

Provide the ability to verify the integrity of programs downloaded on a controller. While techniques like CRCs and checksums are commonly used, they are not cryptographically secure and can be vulnerable to collisions. Preferably cryptographic hash functions (e.g., SHA-2, SHA-3) should be used.

### M0937 Filter Network Traffic

Filter for protocols and payloads associated with program download activity to prevent unauthorized device configurations.

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0800 Authorization Enforcement

All field controllers should restrict the download of programs, including online edits and program appends, to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0945 Code Signing

Utilize code signatures to verify the integrity and authenticity of programs downloaded to the device.

### M0802 Communication Authenticity

Protocols used for device management should authenticate all network messages to prevent unauthorized system changes.

### M0801 Access Management

Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

## Detection

### Detection of Program Download

## Risk Assessment

| Finding                               | Severity | Impact           |
| ------------------------------------- | -------- | ---------------- |
| Program Download technique applicable | Low      | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [MITRE ATT&CK ICS - T0843](https://attack.mitre.org/techniques/T0843)
