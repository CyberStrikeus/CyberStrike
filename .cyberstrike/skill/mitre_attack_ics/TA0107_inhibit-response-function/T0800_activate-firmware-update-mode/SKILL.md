---
name: "T0800_activate-firmware-update-mode"
description: "Adversaries may activate firmware update mode on devices to prevent expected response functions from engaging in reaction to an emergency or process malfunction."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0800
  - inhibit-response-function
technique_id: "T0800"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0800"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0800 Activate Firmware Update Mode

## High-Level Description

Adversaries may activate firmware update mode on devices to prevent expected response functions from engaging in reaction to an emergency or process malfunction. For example, devices such as protection relays may have an operation mode designed for firmware installation. This mode may halt process monitoring and related functions to allow new firmware to be loaded. A device left in update mode may be placed in an inactive holding state if no firmware is provided to it. By entering and leaving a device in this mode, the adversary may deny its usual functionalities.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Activate Firmware Update Mode technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Activate Firmware Update Mode
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Activate Firmware Update Mode by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0800 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0804 Human User Authentication

Devices that allow remote management of firmware should require authentication before allowing any changes. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management

### M0813 Software Process and Device Authentication

Authenticate connections fromsoftware and devices to prevent unauthorized systems from accessing protected management functions.

### M0802 Communication Authenticity

Protocols used for device management should authenticate all network messages to prevent unauthorized system changes.

### M0801 Access Management

All devices or systems changes, including all administrative functions, should require authentication. Consider using access management technologies to enforce authorization on all management interface access attempts, especially when the device does not inherently provide strong authentication and authorization functions.

### M0937 Filter Network Traffic

Filter for protocols and payloads associated with firmware activation or updating activity.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0800 Authorization Enforcement

Restrict configurations changes and firmware updating abilities to only authorized individuals.

## Detection

### Detection of Activate Firmware Update Mode

## Risk Assessment

| Finding                                            | Severity | Impact                    |
| -------------------------------------------------- | -------- | ------------------------- |
| Activate Firmware Update Mode technique applicable | Medium   | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [MITRE ATT&CK ICS - T0800](https://attack.mitre.org/techniques/T0800)
