---
name: "T0816_device-restartshutdown"
description: "Adversaries may forcibly restart or shutdown a device in an ICS environment to disrupt and potentially negatively impact physical processes."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0816
  - inhibit-response-function
technique_id: "T0816"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0816"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0816 Device Restart/Shutdown

## High-Level Description

Adversaries may forcibly restart or shutdown a device in an ICS environment to disrupt and potentially negatively impact physical processes. Methods of device restart and shutdown exist in some devices as built-in, standard functionalities. These functionalities can be executed using interactive device web interfaces, CLIs, and network protocol commands.

Unexpected restart or shutdown of control system devices may prevent expected response functions happening during critical states.

A device restart can also be a sign of malicious device modifications, as many updates require a shutdown in order to take effect.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Device Restart/Shutdown technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Device Restart/Shutdown
- [ ] Verify mitigations are bypassed or absent (9 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Device Restart/Shutdown by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0816 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0802 Communication Authenticity

Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).

### M0800 Authorization Enforcement

All field controllers should restrict the modification of programs to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0942 Disable or Remove Feature or Program

Ensure remote commands that enable device shutdown are disabled if they are not necessary. Examples include DNP3's 0x0D function code or unnecessary device management functions.

### M0937 Filter Network Traffic

Application denylists can be used to block automation protocol functions used to initiate device shutdowns or restarts, such as DNP3's 0x0D function code, or vulnerabilities that can be used to trigger device shutdowns (e.g., CVE-2014-9195, CVE-2015-5374).

### M0801 Access Management

All devices or systems changes, including all administrative functions, should require authentication. Consider using access management technologies to enforce authorization on all management interface access attempts, especially when the device does not inherently provide strong authentication and authorization functions.

### M0813 Software Process and Device Authentication

Authenticate connections from software and devices to prevent unauthorized systems from accessing protected management functions.

## Detection

### Detection of Device Restart/Shutdown

## Risk Assessment

| Finding                                      | Severity | Impact                    |
| -------------------------------------------- | -------- | ------------------------- |
| Device Restart/Shutdown technique applicable | Low      | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [MITRE ATT&CK ICS - T0816](https://attack.mitre.org/techniques/T0816)
