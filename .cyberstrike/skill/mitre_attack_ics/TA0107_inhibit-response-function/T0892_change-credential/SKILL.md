---
name: "T0892_change-credential"
description: "Adversaries may modify software and device credentials to prevent operator and responder access."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0892
  - inhibit-response-function
technique_id: "T0892"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0892"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0892 Change Credential

## High-Level Description

Adversaries may modify software and device credentials to prevent operator and responder access. Depending on the device, the modification or addition of this password could prevent any device configuration actions from being accomplished and may require a factory reset or replacement of hardware. These credentials are often built-in features provided by the device vendors as a means to restrict access to management interfaces.

An adversary with access to valid or hardcoded credentials could change the credential to prevent future authorized device access. Change Credential may be especially damaging when paired with other techniques such as Modify Program, Data Destruction, or Modify Controller Tasking. In these cases, a device’s configuration may be destroyed or include malicious actions for the process environment, which cannot not be removed through normal device configuration actions.

Additionally, recovery of the device and original configuration may be difficult depending on the features provided by the device. In some cases, these passwords cannot be removed onsite and may require that the device be sent back to the vendor for additional recovery steps.

A chain of incidents occurred in Germany, where adversaries locked operators out of their building automation system (BAS) controllers by enabling a previously unset BCU key.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Change Credential technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Change Credential
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Change Credential by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0892 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0927 Password Policies

Applications and appliances that utilize default username and password should be changed immediately after the installation, and before deployment to a production environment.

### M0953 Data Backup

Take and store data backups from end user systems and critical servers. Ensure backup and storage systems are hardened and kept separate from the corporate network to prevent compromise. Maintain and exercise incident response plans , including the management of gold-copy back-up images and configurations for key systems to enable quick recovery and response from adversarial activities that impact control, view, or availability.

### M0811 Redundancy of Service

Retain cold-standby or replacement hardware of similar models to ensure continued operations of critical functions if the primary system is compromised or unavailable.

## Detection

### Detection of Change Credential

## Risk Assessment

| Finding                                | Severity | Impact                    |
| -------------------------------------- | -------- | ------------------------- |
| Change Credential technique applicable | High     | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [German BAS Lockout Dec 2021](https://www.darkreading.com/attacks-breaches/lights-out-cyberattacks-shut-down-building-automation-systems)
- [MITRE ATT&CK ICS - T0892](https://attack.mitre.org/techniques/T0892)
