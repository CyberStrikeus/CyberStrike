---
name: "T1204.004_malicious-copy-and-paste"
description: "An adversary may rely upon a user copying and pasting code in order to gain execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204.004
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1204.004"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1204/004"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1204
  - T1204.001
  - T1204.002
  - T1204.003
  - T1204.005
prerequisites:
  - T1204
severity_boost:
  T1204: "Chain with T1204 for deeper attack path"
  T1204.001: "Chain with T1204.001 for deeper attack path"
  T1204.002: "Chain with T1204.002 for deeper attack path"
---

# T1204.004 Malicious Copy and Paste

> **Sub-technique of:** T1204

## High-Level Description

An adversary may rely upon a user copying and pasting code in order to gain execution. Users may be subjected to social engineering to get them to copy and paste code directly into a Command and Scripting Interpreter. One such strategy is "ClickFix," in which adversaries present users with seemingly helpful solutions—such as prompts to fix errors or complete CAPTCHAs—that instead instruct the user to copy and paste malicious code.

Malicious websites, such as those used in Drive-by Compromise, may present fake error messages or CAPTCHA prompts that instruct users to open a terminal or the Windows Run Dialog box and execute an arbitrary command. These commands may be obfuscated using encoding or other techniques to conceal malicious intent. Once executed, the adversary will typically be able to establish a foothold on the victim's machine.

Adversaries may also leverage phishing emails for this purpose. When a user attempts to open an attachment, they may be presented with a fake error and offered a malicious command to paste as a solution, consistent with the "ClickFix" strategy.

Tricking a user into executing a command themselves may help to bypass email filtering, browser sandboxing, or other mitigations designed to protect users against malicious downloaded files.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Malicious Copy and Paste technique is applicable to target environment
- [ ] Check Linux systems for indicators of Malicious Copy and Paste
- [ ] Check macOS systems for indicators of Malicious Copy and Paste
- [ ] Check Windows systems for indicators of Malicious Copy and Paste
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malicious Copy and Paste by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1204.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

Use application control where appropriate. PowerShell Constrained Language mode can be used to restrict access to sensitive or otherwise dangerous language elements such as those used to execute arbitrary Windows APIs or files (e.g., `Add-Type`).

### M1031 Network Intrusion Prevention

If a link is being requested by a user, network intrusion prevention systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M1021 Restrict Web-Based Content

If a link is being requested by a user, block unknown or unused files in transit by default that should not be downloaded or by policy from suspicious sites as a best practice to prevent some vectors, such as `.scr`, `.exe`, `.pif`, `.cpl`, etc.

## Detection

### User Execution – Malicious Copy & Paste (browser/email → shell with obfuscated one-liner) – T1204.004

## Risk Assessment

| Finding                                       | Severity | Impact    |
| --------------------------------------------- | -------- | --------- |
| Malicious Copy and Paste technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [AhnLab Malicioys Copy Paste 2024](https://asec.ahnlab.com/en/73952/)
- [AhnLab LummaC2 2025](https://asec.ahnlab.com/en/85699/)
- [Reliaquest CAPTCHA 2024](https://www.reliaquest.com/blog/using-captcha-for-compromise/)
- [Sekoia ClickFake 2025](https://blog.sekoia.io/clickfake-interview-campaign-by-lazarus/)
- [CloudSEK Lumma Stealer 2024](https://www.cloudsek.com/blog/unmasking-the-danger-lumma-stealer-malware-exploits-fake-captcha-pages)
- [Proofpoint ClickFix 2024](https://www.proofpoint.com/us/blog/threat-insight/security-brief-clickfix-social-engineering-technique-floods-threat-landscape)
- [Atomic Red Team - T1204.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204.004)
- [MITRE ATT&CK - T1204.004](https://attack.mitre.org/techniques/T1204/004)
