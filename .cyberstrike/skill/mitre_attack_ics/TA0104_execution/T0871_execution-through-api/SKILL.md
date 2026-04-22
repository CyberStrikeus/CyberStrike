---
name: "T0871_execution-through-api"
description: "Adversaries may attempt to leverage Application Program Interfaces (APIs) used for communication between control software and the hardware."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0871
  - execution
technique_id: "T0871"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0871"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0871 Execution through API

## High-Level Description

Adversaries may attempt to leverage Application Program Interfaces (APIs) used for communication between control software and the hardware. Specific functionality is often coded into APIs which can be called by software to engage specific functions on a device or other software.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Execution through API technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Execution through API
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Execution through API by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0871 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0938 Execution Prevention

Minimize the exposure of API calls that allow the execution of code.

### M0800 Authorization Enforcement

All APIs used to perform execution, especially those hosted on embedded controllers (e.g., PLCs), should provide adequate authorization enforcement of user access. Minimize user's access to only required API calls.

### M0804 Human User Authentication

All APIs on remote systems or local processes should require the authentication of users before executing any code or system changes.

### M0801 Access Management

Access Management technologies can be used to enforce authorization policies and decisions, especially when existing field devices do not provide capabilities to support user identification and authentication. These technologies typically utilize an in-line network device or gateway system to prevent access to unauthenticated users, while also integrating with an authentication service to first verify user credentials.

## Detection

### Detection of Execution through API

## Risk Assessment

| Finding                                    | Severity | Impact    |
| ------------------------------------------ | -------- | --------- |
| Execution through API technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [MITRE ATT&CK ICS - T0871](https://attack.mitre.org/techniques/T0871)
