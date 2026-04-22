---
name: "T1553.001_gatekeeper-bypass"
description: "Adversaries may modify file attributes and subvert Gatekeeper functionality to evade user prompts and execute untrusted programs."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.001
  - defense-evasion
  - macos
  - sub-technique
technique_id: "T1553.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1553/001"
tech_stack:
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.002
  - T1553.003
  - T1553.004
  - T1553.005
  - T1553.006
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
  T1553.003: "Chain with T1553.003 for deeper attack path"
---

# T1553.001 Gatekeeper Bypass

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may modify file attributes and subvert Gatekeeper functionality to evade user prompts and execute untrusted programs. Gatekeeper is a set of technologies that act as layer of Apple’s security model to ensure only trusted applications are executed on a host. Gatekeeper was built on top of File Quarantine in Snow Leopard (10.6, 2009) and has grown to include Code Signing, security policy compliance, Notarization, and more. Gatekeeper also treats applications running for the first time differently than reopened applications.

Based on an opt-in system, when files are downloaded an extended attribute (xattr) called `com.apple.quarantine` (also known as a quarantine flag) can be set on the file by the application performing the download. Launch Services opens the application in a suspended state. For first run applications with the quarantine flag set, Gatekeeper executes the following functions:

1. Checks extended attribute – Gatekeeper checks for the quarantine flag, then provides an alert prompt to the user to allow or deny execution.

2. Checks System Policies - Gatekeeper checks the system security policy, allowing execution of apps downloaded from either just the App Store or the App Store and identified developers.

3. Code Signing – Gatekeeper checks for a valid code signature from an Apple Developer ID.

4. Notarization - Using the `api.apple-cloudkit.com` API, Gatekeeper reaches out to Apple servers to verify or pull down the notarization ticket and ensure the ticket is not revoked. Users can override notarization, which will result in a prompt of executing an “unauthorized app” and the security policy will be modified.

Adversaries can subvert one or multiple security controls within Gatekeeper checks through logic errors (e.g. Exploitation for Defense Evasion), unchecked file types, and external libraries. For example, prior to macOS 13 Ventura, code signing and notarization checks were only conducted on first launch, allowing adversaries to write malicious executables to previously opened applications in order to bypass Gatekeeper security checks.

Applications and files loaded onto the system from a USB flash drive, optical disk, external hard drive, from a drive shared over the local network, or using the curl command may not set the quarantine flag. Additionally, it is possible to avoid setting the quarantine flag using Drive-by Compromise.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS

## What to Check

- [ ] Identify if Gatekeeper Bypass technique is applicable to target environment
- [ ] Check macOS systems for indicators of Gatekeeper Bypass
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Gatekeeper Bypass

Gatekeeper Bypass via command line

**Supported Platforms:** macos

```bash
xattr -d com.apple.quarantine #{app_path}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Gatekeeper Bypass by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
System settings can prevent applications from running that haven't been downloaded through the Apple Store which can help mitigate some of these issues.


## Detection

### Detect Gatekeeper Bypass via Quarantine Flag and Trust Control Manipulation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Gatekeeper Bypass technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Application Bundle Manipulation Brandon Dalton](https://redcanary.com/blog/mac-application-bundles/)
- [theevilbit gatekeeper bypass 2021](https://theevilbit.github.io/posts/gatekeeper_not_a_bypass/)
- [OceanLotus for OS X](https://www.alienvault.com/blogs/labs-research/oceanlotus-for-os-x-an-application-bundle-pretending-to-be-an-adobe-flash-update)
- [TheEclecticLightCompany Quarantine and the flag](https://eclecticlight.co/2020/10/29/quarantine-and-the-quarantine-flag/)
- [TheEclecticLightCompany apple notarization ](https://eclecticlight.co/2020/08/28/how-notarization-works/)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Atomic Red Team - T1553.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.001)
- [MITRE ATT&CK - T1553.001](https://attack.mitre.org/techniques/T1553/001)
