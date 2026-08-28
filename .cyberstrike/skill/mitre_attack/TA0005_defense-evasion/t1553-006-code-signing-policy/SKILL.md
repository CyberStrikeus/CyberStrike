---
name: "T1553.006_code-signing-policy-modification"
description: "Adversaries may modify code signing policies to enable execution of unsigned or self-signed code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.006
  - defense-evasion
  - windows
  - macos
  - sub-technique
technique_id: "T1553.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1553/006"
tech_stack:
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.001
  - T1553.002
  - T1553.003
  - T1553.004
  - T1553.005
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
---

# T1553.006 Code Signing Policy Modification

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may modify code signing policies to enable execution of unsigned or self-signed code. Code signing provides a level of authenticity on a program from a developer and a guarantee that the program has not been tampered with. Security controls can include enforcement mechanisms to ensure that only valid, signed code can be run on an operating system.

Some of these security controls may be enabled by default, such as Driver Signature Enforcement (DSE) on Windows or System Integrity Protection (SIP) on macOS. Other such controls may be disabled by default but are configurable through application controls, such as only allowing signed Dynamic-Link Libraries (DLLs) to execute on a system. Since it can be useful for developers to modify default signature enforcement policies during the development and testing of applications, disabling of these features may be possible with elevated permissions.

Adversaries may modify code signing policies in a number of ways, including through use of command-line or GUI utilities, Modify Registry, rebooting the computer in a debug/recovery mode, or by altering the value of variables in kernel memory. Examples of commands that can modify the code signing policy of a system include <code>bcdedit.exe -set TESTSIGNING ON</code> on Windows and <code>csrutil disable</code> on macOS. Depending on the implementation, successful modification of a signing policy may require reboot of the compromised system. Additionally, some implementations can introduce visible artifacts for the user (ex: a watermark in the corner of the screen stating the system is in Test Mode). Adversaries may attempt to remove such artifacts.

To gain access to kernel memory to modify variables related to signature checks, such as modifying <code>g_CiOptions</code> to disable Driver Signature Enforcement, adversaries may conduct Exploitation for Privilege Escalation using a signed, but vulnerable driver.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS

## What to Check

- [ ] Identify if Code Signing Policy Modification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Code Signing Policy Modification
- [ ] Check macOS systems for indicators of Code Signing Policy Modification
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Code Signing Policy Modification

Allows adversaries to subvert trust controls by modifying the code signing policy, enabling the execution of unsigned drivers.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
bcdedit /set testsigning on
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Code Signing Policy Modification by examining the target platforms (Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Limit the usage of local administrator and domain administrator accounts to be used for day-to-day operations that may expose them to potential adversaries.

### M1046 Boot Integrity

Use of Secure Boot may prevent some implementations of modification to code signing policies.

### M1024 Restrict Registry Permissions

Ensure proper permissions are set for the Registry to prevent users from modifying keys related to code signing policies.

## Detection

### Detect Code Signing Policy Modification (Windows & macOS)

## Risk Assessment

| Finding                                               | Severity | Impact          |
| ----------------------------------------------------- | -------- | --------------- |
| Code Signing Policy Modification technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Apple Disable SIP](https://developer.apple.com/documentation/security/disabling_and_enabling_system_integrity_protection)
- [F-Secure BlackEnergy 2014](https://blog-assets.f-secure.com/wp-content/uploads/2019/10/15163408/BlackEnergy_Quedagh.pdf)
- [FireEye HIKIT Rootkit Part 2](https://web.archive.org/web/20210920172620/https://www.fireeye.com/blog/threat-research/2012/08/hikit-rootkit-advanced-persistent-attack-techniques-part-2.html)
- [Microsoft Unsigned Driver Apr 2017](https://docs.microsoft.com/en-us/windows-hardware/drivers/install/installing-an-unsigned-driver-during-development-and-test)
- [Microsoft DSE June 2017](<https://docs.microsoft.com/en-us/previous-versions/windows/hardware/design/dn653559(v=vs.85)?redirectedfrom=MSDN>)
- [Microsoft TESTSIGNING Feb 2021](https://docs.microsoft.com/en-us/windows-hardware/drivers/install/the-testsigning-boot-configuration-option)
- [Unit42 AcidBox June 2020](https://unit42.paloaltonetworks.com/acidbox-rare-malware/)
- [GitHub Turla Driver Loader](https://github.com/hfiref0x/TDL)
- [Atomic Red Team - T1553.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.006)
- [MITRE ATT&CK - T1553.006](https://attack.mitre.org/techniques/T1553/006)
