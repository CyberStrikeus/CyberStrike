---
name: "T0864_transient-cyber-asset"
description: "Adversaries may target devices that are transient across ICS networks and external networks."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0864
  - initial-access
technique_id: "T0864"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0864"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0864 Transient Cyber Asset

## High-Level Description

Adversaries may target devices that are transient across ICS networks and external networks. Normally, transient assets are brought into an environment by authorized personnel and do not remain in that environment on a permanent basis. Transient assets are commonly needed to support management functions and may be more common in systems where a remotely managed asset is not feasible, external connections for remote access do not exist, or 3rd party contractor/vendor access is required. 

Adversaries may take advantage of transient assets in different ways. For instance, adversaries may target a transient asset when it is connected to an external network and then leverage its trusted access in another environment to launch an attack. They may also take advantage of installed applications and libraries that are used by legitimate end-users to interact with control system devices. 

Transient assets, in some cases, may not be deployed with a secure configuration leading to weaknesses that could allow an adversary to propagate malicious executable code, e.g., the transient asset may be infected by malware and when connected to an ICS environment the malware propagates onto other systems.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Transient Cyber Asset technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Transient Cyber Asset
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Transient Cyber Asset by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0864 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0941 Encrypt Sensitive Information
Consider implementing full disk encryption, especially if engineering workstations are transient assets that are more likely to be lost, stolen, or tampered with.

### M0947 Audit
Integrity checking of transient assets can include performing the validation of the booted operating system and programs using TPM-based technologies, such as Secure Boot and Trusted Boot. It can also include verifying filesystem changes, such as programs and configuration files stored on the system, executing processes, libraries, accounts, and open ports.

### M0949 Antivirus/Antimalware
Install anti-virus software on all workstation and transient assets that may have external access, such as to web, email, or remote file shares.

### M0930 Network Segmentation
Segment and control software movement between business and OT environments by way of one directional DMZs. Web access should be restricted from the OT environment. Engineering workstations, including transient cyber assets (TCAs) should have minimal connectivity to external networks, including Internet and email, further limit the extent to which these devices are dual-homed to multiple networks.

### M0951 Update Software
Update software on control network assets when possible. If feasible, use modern operating systems and software to reduce exposure to known vulnerabilities.


## Detection

### Detection of Transient Cyber Asset


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Transient Cyber Asset technique applicable | Low | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [North American Electric Reliability Corporation June 2021](https://www.nerc.com/pa/Stand/Glossary%20of%20Terms/Glossary_of_Terms.pdf)
- [MITRE ATT&CK ICS - T0864](https://attack.mitre.org/techniques/T0864)
