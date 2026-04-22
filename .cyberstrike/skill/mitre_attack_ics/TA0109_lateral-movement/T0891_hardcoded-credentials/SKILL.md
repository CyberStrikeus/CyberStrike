---
name: "T0891_hardcoded-credentials"
description: "Adversaries may leverage credentials that are hardcoded in software or firmware to gain an unauthorized interactive user session to an asset."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0891
  - lateral-movement
  - persistence
technique_id: "T0891"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
  - persistence
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0891"
tech_stack:
  - ics
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0891 Hardcoded Credentials

## High-Level Description

Adversaries may leverage credentials that are hardcoded in software or firmware to gain an unauthorized interactive user session to an asset. Examples credentials that may be hardcoded in an asset include:

- Username/Passwords
- Cryptographic keys/Certificates
- API tokens

Unlike Default Credentials, these credentials are built into the system in a way that they either cannot be changed by the asset owner, or may be infeasible to change because of the impact it would cause to the control system operation. These credentials may be reused across whole product lines or device models and are often not published or known to the owner and operators of the asset.

Adversaries may utilize these hardcoded credentials to move throughout the control system environment or provide reliable access for their tools to interact with industrial assets.

## Kill Chain Phase

- Lateral Movement (TA0109)
- Persistence (TA0110)

**Platforms:** ICS

## What to Check

- [ ] Identify if Hardcoded Credentials technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Hardcoded Credentials
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Hardcoded Credentials by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0891 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0801 Access Management

Ensure embedded controls and network devices are protected through access management, as these devices often have unknown hardcoded accounts which could be used to gain unauthorized access.

## Detection

### Detection of Hardcoded Credentials

## Risk Assessment

| Finding                                    | Severity | Impact           |
| ------------------------------------------ | -------- | ---------------- |
| Hardcoded Credentials technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [MITRE ATT&CK ICS - T0891](https://attack.mitre.org/techniques/T0891)
