---
name: "T1559.003_xpc-services"
description: "Adversaries can provide malicious content to an XPC service daemon for local code execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1559.003
  - execution
  - macos
  - sub-technique
technique_id: "T1559.003"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1559/003"
tech_stack:
  - macos
cwe_ids:
  - CWE-94
chains_with:
  - T1559
  - T1559.001
  - T1559.002
prerequisites:
  - T1559
severity_boost:
  T1559: "Chain with T1559 for deeper attack path"
  T1559.001: "Chain with T1559.001 for deeper attack path"
  T1559.002: "Chain with T1559.002 for deeper attack path"
---

# T1559.003 XPC Services

> **Sub-technique of:** T1559

## High-Level Description

Adversaries can provide malicious content to an XPC service daemon for local code execution. macOS uses XPC services for basic inter-process communication between various processes, such as between the XPC Service daemon and third-party application privileged helper tools. Applications can send messages to the XPC Service daemon, which runs as root, using the low-level XPC Service <code>C API</code> or the high level <code>NSXPCConnection API</code> in order to handle tasks that require elevated privileges (such as network connections). Applications are responsible for providing the protocol definition which serves as a blueprint of the XPC services. Developers typically use XPC Services to provide applications stability and privilege separation between the application client and the daemon.

Adversaries can abuse XPC services to execute malicious content. Requests for malicious execution can be passed through the application's XPC Services handler. This may also include identifying and abusing improper XPC client validation and/or poor sanitization of input parameters to conduct Exploitation for Privilege Escalation.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** macOS

## What to Check

- [ ] Identify if XPC Services technique is applicable to target environment
- [ ] Check macOS systems for indicators of XPC Services
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to XPC Services by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1559.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1013 Application Developer Guidance

Enable the Hardened Runtime capability when developing applications. Do not include the <code>com.apple.security.get-task-allow</code> entitlement with the value set to any variation of true.

## Detection

### Detect Abuse of XPC Services (T1559.003)

## Risk Assessment

| Finding                           | Severity | Impact    |
| --------------------------------- | -------- | --------- |
| XPC Services technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [creatingXPCservices](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingXPCServices.html#//apple_ref/doc/uid/10000172i-SW6-SW1)
- [Designing Daemons Apple Dev](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html)
- [CVMServer Vuln](https://www.trendmicro.com/en_us/research/21/f/CVE-2021-30724_CVMServer_Vulnerability_in_macOS_and_iOS.html)
- [Learn XPC Exploitation](https://wojciechregula.blog/post/learn-xpc-exploitation-part-3-code-injections/)
- [Atomic Red Team - T1559.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1559.003)
- [MITRE ATT&CK - T1559.003](https://attack.mitre.org/techniques/T1559/003)
