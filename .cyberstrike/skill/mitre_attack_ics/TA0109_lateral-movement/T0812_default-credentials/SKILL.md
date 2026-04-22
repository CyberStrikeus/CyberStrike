---
name: "T0812_default-credentials"
description: "Adversaries may leverage manufacturer or supplier set default credentials on control system devices."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0812
  - lateral-movement
technique_id: "T0812"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0812"
tech_stack:
  - ics
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0812 Default Credentials

## High-Level Description

Adversaries may leverage manufacturer or supplier set default credentials on control system devices. These default credentials may have administrative permissions and may be necessary for initial configuration of the device. It is general best practice to change the passwords for these accounts as soon as possible, but some manufacturers may have devices that have passwords or usernames that cannot be changed.

Default credentials are normally documented in an instruction manual that is either packaged with the device, published online through official means, or published online through unofficial means. Adversaries may leverage default credentials that have not been properly modified or disabled.

## Kill Chain Phase

- Lateral Movement (TA0109)

**Platforms:** ICS

## What to Check

- [ ] Identify if Default Credentials technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Default Credentials
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Default Credentials by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0812 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0927 Password Policies

Review vendor documents and security alerts for potentially unknown or overlooked default credentials within existing devices

### M0801 Access Management

Ensure embedded controls and network devices are protected through access management, as these devices often have unknown default accounts which could be used to gain unauthorized access.

## Detection

### Detection of Default Credentials

## Risk Assessment

| Finding                                  | Severity | Impact           |
| ---------------------------------------- | -------- | ---------------- |
| Default Credentials technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Keith Stouffer May 2015](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-82r2.pdf)
- [MITRE ATT&CK ICS - T0812](https://attack.mitre.org/techniques/T0812)
