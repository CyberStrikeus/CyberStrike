---
name: "T0851_rootkit"
description: "Adversaries may deploy rootkits to hide the presence of programs, files, network connections, services, drivers, and other system components."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0851
  - evasion
  - inhibit-response-function
technique_id: "T0851"
tactic: "evasion"
all_tactics:
  - evasion
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0851"
tech_stack:
  - ics
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0851 Rootkit

## High-Level Description

Adversaries may deploy rootkits to hide the presence of programs, files, network connections, services, drivers, and other system components. Rootkits are programs that hide the existence of malware by intercepting and modifying operating-system API calls that supply system information. Rootkits or rootkit-enabling functionality may reside at the user or kernel level in the operating system, or lower.

Firmware rootkits that affect the operating system yield nearly full control of the system. While firmware rootkits are normally developed for the main processing board, they can also be developed for the I/O that is attached to an asset. Compromise of this firmware allows the modification of all of the process variables and functions the module engages in. This may result in commands being disregarded and false information being fed to the main device. By tampering with device processes, an adversary may inhibit its expected response functions and possibly enable Impact.

## Kill Chain Phase

- Evasion (TA0103)
- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Rootkit technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Rootkit
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Rootkit by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0851 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0945 Code Signing

Digital signatures may be used to ensure application DLLs are authentic prior to execution.

### M0947 Audit

Audit the integrity of PLC system and application code functionality, such as the manipulation of standard function blocks (e.g., Organizational Blocks) that manage the execution of application logic programs.

## Detection

### Detection of Rootkit

## Risk Assessment

| Finding                      | Severity | Impact  |
| ---------------------------- | -------- | ------- |
| Rootkit technique applicable | High     | Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1014)
- [MITRE ATT&CK ICS - T0851](https://attack.mitre.org/techniques/T0851)
