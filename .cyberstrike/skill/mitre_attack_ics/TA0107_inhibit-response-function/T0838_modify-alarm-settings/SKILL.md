---
name: "T0838_modify-alarm-settings"
description: "Adversaries may modify alarm settings to prevent alerts that may inform operators of their presence or to prevent responses to dangerous and unintended scenarios."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0838
  - inhibit-response-function
technique_id: "T0838"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0838"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0838 Modify Alarm Settings

## High-Level Description

Adversaries may modify alarm settings to prevent alerts that may inform operators of their presence or to prevent responses to dangerous and unintended scenarios. Reporting messages are a standard part of data acquisition in control systems. Reporting messages are used as a way to transmit system state information and acknowledgements that specific actions have occurred. These messages provide vital information for the management of a physical process, and keep operators, engineers, and administrators aware of the state of system devices and physical processes.

If an adversary is able to change the reporting settings, certain events could be prevented from being reported. This type of modification can also prevent operators or devices from performing actions to keep the system in a safe state. If critical reporting messages cannot trigger these actions then a Impact could occur.

In ICS environments, the adversary may have to use Alarm Suppression or contend with multiple alarms and/or alarm propagation to achieve a specific goal to evade detection or prevent intended responses from occurring. Methods of suppression often rely on modification of alarm settings, such as modifying in memory code to fixed values or tampering with assembly level instruction code.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Modify Alarm Settings technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Modify Alarm Settings
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Modify Alarm Settings by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0838 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0807 Network Allowlists

Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0813 Software Process and Device Authentication

Authenticate connections fromsoftware and devices to prevent unauthorized systems from accessing protected management functions.

### M0800 Authorization Enforcement

Only authorized personnel should be able to change settings for alarms.

### M0918 User Account Management

Limit privileges of user accounts and groups so that only designated administrators or engineers can interact with alarm management and alarm configuration thresholds.

### M0801 Access Management

All devices or systems changes, including all administrative functions, should require authentication. Consider using access management technologies to enforce authorization on all management interface access attempts, especially when the device does not inherently provide strong authentication and authorization functions.

## Detection

### Detection of Modify Alarm Settings

## Risk Assessment

| Finding                                    | Severity | Impact                    |
| ------------------------------------------ | -------- | ------------------------- |
| Modify Alarm Settings technique applicable | Low      | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Jos Wetzels, Marina Krotofil 2019](https://troopers.de/downloads/troopers19/TROOPERS19_NGI_IoT_diet_poisoned_fruit.pdf)
- [MITRE ATT&CK ICS - T0838](https://attack.mitre.org/techniques/T0838)
