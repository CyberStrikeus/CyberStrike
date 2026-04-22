---
name: "T0894_system-binary-proxy-execution"
description: "Adversaries may bypass process and/or signature-based defenses by proxying execution of malicious content with signed, or otherwise trusted, binaries."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0894
  - evasion
technique_id: "T0894"
tactic: "evasion"
all_tactics:
  - evasion
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0894"
tech_stack:
  - ics
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0894 System Binary Proxy Execution

## High-Level Description

Adversaries may bypass process and/or signature-based defenses by proxying execution of malicious content with signed, or otherwise trusted, binaries. Binaries used in this technique are often Microsoft-signed files, indicating that they have been either downloaded from Microsoft or are already native in the operating system. Binaries signed with trusted digital certificates can typically execute on Windows systems protected by digital signature validation. Several Microsoft signed binaries that are default on Windows installations can be used to proxy execution of other files or commands. Similarly, on Linux systems adversaries may abuse trusted binaries such as split to proxy execution of malicious commands. 

Adversaries may abuse application binaries installed on a system for proxy execution of malicious code or domain-specific commands. These commands could be used to target local resources on the device or networked devices within the environment through defined APIs (Execution through API) or application-specific programming languages (e.g., MicroSCADA SCIL). Application binaries may be signed by the developer or generally trusted by the operators, analysts, and monitoring tools accustomed to the environment. These applications may be developed and/or directly provided by the device vendor to enable configuration, management, and operation of their devices without many alternatives. 

Adversaries may seek to target these trusted application binaries to execute or send commands without the development of custom malware. For example, adversaries may target a SCADA server binary which has the existing ability to send commands to substation devices, such as through IEC 104 command messages. Proxy execution may still require the development of custom tools to hook into the application binary’s execution.

## Kill Chain Phase

- Evasion (TA0103)

**Platforms:** ICS

## What to Check

- [ ] Identify if System Binary Proxy Execution technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of System Binary Proxy Execution
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to System Binary Proxy Execution by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0894 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0938 Execution Prevention
Disallow the execution of applications/programs which are not required for normal system functions, including any specific command-line arguments which may allow the execution of proxy commands or application binaries.


## Detection

### Detection of System Binary Proxy Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Binary Proxy Execution technique applicable | Medium | Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [GTFO split](https://gtfobins.github.io/gtfobins/split/)
- [LOLBAS Project](https://github.com/LOLBAS-Project/LOLBAS#criteria)
- [split man page](https://man7.org/linux/man-pages/man1/split.1.html)
- [MITRE ATT&CK ICS - T0894](https://attack.mitre.org/techniques/T0894)
