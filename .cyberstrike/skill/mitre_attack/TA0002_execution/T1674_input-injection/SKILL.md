---
name: "T1674_input-injection"
description: "Adversaries may simulate keystrokes on a victim’s computer by various means to perform any type of action on behalf of the user, such as launching the command interpreter using keyboard shortcuts, ..."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1674
  - execution
  - windows
  - macos
  - linux
technique_id: "T1674"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1674"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1674 Input Injection

## High-Level Description

Adversaries may simulate keystrokes on a victim’s computer by various means to perform any type of action on behalf of the user, such as launching the command interpreter using keyboard shortcuts, typing an inline script to be executed, or interacting directly with a GUI-based application. These actions can be preprogrammed into adversary tooling or executed through physical devices such as Human Interface Devices (HIDs).

For example, adversaries have used tooling that monitors the Windows message loop to detect when a user visits bank-specific URLs. If detected, the tool then simulates keystrokes to open the developer console or select the address bar, pastes malicious JavaScript from the clipboard, and executes it - enabling manipulation of content within the browser, such as replacing bank account numbers during transactions.

Adversaries have also used malicious USB devices to emulate keystrokes that launch PowerShell, leading to the download and execution of malware from adversary-controlled servers.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Input Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Input Injection
- [ ] Check macOS systems for indicators of Input Injection
- [ ] Check Linux systems for indicators of Input Injection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Input Injection by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1674 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1034 Limit Hardware Installation

Limit the use of USB devices and removable media within a network.

### M1038 Execution Prevention

Denylist scripting and use application control where appropriate. For example, PowerShell Constrained Language mode can be used to restrict access to sensitive or otherwise dangerous language elements such as those used to execute arbitrary Windows APIs or files (e.g., `Add-Type`).

## Detection

### Detection Strategy for Input Injection

## Risk Assessment

| Finding                              | Severity | Impact    |
| ------------------------------------ | -------- | --------- |
| Input Injection technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [BleepingComputer BackSwap](https://www.bleepingcomputer.com/news/security/backswap-banking-trojan-uses-never-before-seen-techniques/)
- [BleepingComputer USB](https://www.bleepingcomputer.com/news/security/fbi-hackers-sending-malicious-usb-drives-and-teddy-bears-via-usps/)
- [welivesecurity BackSwap](https://www.welivesecurity.com/2018/05/25/backswap-malware-empty-bank-accounts/)
- [Atomic Red Team - T1674](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1674)
- [MITRE ATT&CK - T1674](https://attack.mitre.org/techniques/T1674)
