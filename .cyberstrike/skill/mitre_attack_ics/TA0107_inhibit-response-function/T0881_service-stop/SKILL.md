---
name: "T0881_service-stop"
description: "Adversaries may stop or disable services on a system to render those services unavailable to legitimate users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0881
  - inhibit-response-function
technique_id: "T0881"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0881"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0881 Service Stop

## High-Level Description

Adversaries may stop or disable services on a system to render those services unavailable to legitimate users. Stopping critical services can inhibit or stop response to an incident or aid in the adversary's overall objectives to cause damage to the environment. Services may not allow for modification of their data stores while running. Adversaries may stop services in order to conduct Data Destruction.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Service Stop technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Service Stop
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Service Stop by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0881 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0918 User Account Management

Limit privileges of user accounts and groups so that only authorized administrators can change service states and configurations.

### M0924 Restrict Registry Permissions

Ensure proper registry permissions are in place to inhibit adversaries from disabling or interfering with critical services.

### M0922 Restrict File and Directory Permissions

Ensure proper process and file permissions are in place to inhibit adversaries from disabling or interfering with critical services.

### M0930 Network Segmentation

Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

## Detection

### Detection of Service Stop

## Risk Assessment

| Finding                           | Severity | Impact                    |
| --------------------------------- | -------- | ------------------------- |
| Service Stop technique applicable | High     | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Enterprise ATT&CK](https://attack.mitre.org/techniques/T1489/)
- [MITRE ATT&CK ICS - T0881](https://attack.mitre.org/techniques/T0881)
