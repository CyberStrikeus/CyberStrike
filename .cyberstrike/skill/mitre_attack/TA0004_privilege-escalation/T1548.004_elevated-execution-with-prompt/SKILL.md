---
name: "T1548.004_elevated-execution-with-prompt"
description: "Adversaries may leverage the <code>AuthorizationExecuteWithPrivileges</code> API to escalate privileges by prompting the user for credentials."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.004
  - privilege-escalation
  - defense-evasion
  - macos
  - sub-technique
technique_id: "T1548.004"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1548/004"
tech_stack:
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1548
  - T1548.001
  - T1548.002
  - T1548.003
  - T1548.005
  - T1548.006
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
---

# T1548.004 Elevated Execution with Prompt

> **Sub-technique of:** T1548

## High-Level Description

Adversaries may leverage the <code>AuthorizationExecuteWithPrivileges</code> API to escalate privileges by prompting the user for credentials. The purpose of this API is to give application developers an easy way to perform operations with root privileges, such as for application installation or updating. This API does not validate that the program requesting root privileges comes from a reputable source or has been maliciously modified.

Although this API is deprecated, it still fully functions in the latest releases of macOS. When calling this API, the user will be prompted to enter their credentials but no checks on the origin or integrity of the program are made. The program calling the API may also load world writable files which can be modified to perform malicious behavior with elevated privileges.

Adversaries may abuse <code>AuthorizationExecuteWithPrivileges</code> to obtain root privileges in order to install malicious software on victims and install persistence mechanisms. This technique may be combined with Masquerading to trick the user into granting escalated privileges to malicious code. This technique has also been shown to work by modifying legitimate programs present on the machine that make use of this API.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** macOS

## What to Check

- [ ] Identify if Elevated Execution with Prompt technique is applicable to target environment
- [ ] Check macOS systems for indicators of Elevated Execution with Prompt
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Elevated Execution with Prompt by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

System settings can prevent applications from running that haven't been downloaded through the Apple Store which may help mitigate some of these issues. Not allowing unsigned applications from being run may also mitigate some risk.

## Detection

### macOS AuthorizationExecuteWithPrivileges Elevation Prompt Detection

## Risk Assessment

| Finding                                             | Severity | Impact               |
| --------------------------------------------------- | -------- | -------------------- |
| Elevated Execution with Prompt technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [AppleDocs AuthorizationExecuteWithPrivileges](https://developer.apple.com/documentation/security/1540038-authorizationexecutewithprivileg)
- [Carbon Black Shlayer Feb 2019](https://blogs.vmware.com/security/2020/02/vmware-carbon-black-tau-threat-analysis-shlayer-macos.html)
- [Death by 1000 installers; it's all broken!](https://speakerdeck.com/patrickwardle/defcon-2017-death-by-1000-installers-its-all-broken?slide=8)
- [OSX Coldroot RAT](https://objective-see.com/blog/blog_0x2A.html)
- [Atomic Red Team - T1548.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.004)
- [MITRE ATT&CK - T1548.004](https://attack.mitre.org/techniques/T1548/004)
