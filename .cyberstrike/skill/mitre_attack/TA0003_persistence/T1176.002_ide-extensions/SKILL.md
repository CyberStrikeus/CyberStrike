---
name: "T1176.002_ide-extensions"
description: "Adversaries may abuse an integrated development environment (IDE) extension to establish persistent access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1176.002
  - persistence
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1176.002"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1176/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1176
  - T1176.001
prerequisites:
  - T1176
severity_boost:
  T1176: "Chain with T1176 for deeper attack path"
  T1176.001: "Chain with T1176.001 for deeper attack path"
---

# T1176.002 IDE Extensions

> **Sub-technique of:** T1176

## High-Level Description

Adversaries may abuse an integrated development environment (IDE) extension to establish persistent access to victim systems. IDEs such as Visual Studio Code, IntelliJ IDEA, and Eclipse support extensions - software components that add features like code linting, auto-completion, task automation, or integration with tools like Git and Docker. A malicious extension can be installed through an extension marketplace (i.e., Compromise Software Dependencies and Development Tools) or side-loaded directly into the IDE. 

In addition to installing malicious extensions, adversaries may also leverage benign ones. For example, adversaries may establish persistent SSH tunnels via the use of the VSCode Remote SSH extension (i.e., IDE Tunneling). 

Trust is typically established through the installation process; once installed, the malicious extension is run every time that the IDE is launched. The extension can then be used to execute arbitrary code, establish a backdoor, mine cryptocurrency, or exfiltrate data.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if IDE Extensions technique is applicable to target environment
- [ ] Check Linux systems for indicators of IDE Extensions
- [ ] Check macOS systems for indicators of IDE Extensions
- [ ] Check Windows systems for indicators of IDE Extensions
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to IDE Extensions by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1176.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
Set an IDE extension allow or deny list as appropriate for your security policy.

### M1051 Update Software
Ensure operating systems and IDEs are using the most current version.

### M1047 Audit
Ensure extensions that are installed are the intended ones, as many malicious extensions may masquerade as legitimate ones.

### M1033 Limit Software Installation
Only install IDE extensions from trusted sources that can be verified.

### M1017 User Training
Train users to minimize IDE extension use, and to only install trusted extensions.


## Detection

### Detect malicious IDE extension install/usage and IDE tunneling


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IDE Extensions technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Abramovsky VSCode Security](https://blog.checkpoint.com/securing-the-cloud/malicious-vscode-extensions-with-more-than-45k-downloads-steal-pii-and-enable-backdoors/)
- [Lakshmanan Visual Studio Marketplace](https://thehackernews.com/2023/01/hackers-distributing-malicious-visual.html)
- [Mnemonic misuse visual studio](https://www.mnemonic.io/resources/blog/misuse-of-visual-studio-code-for-traffic-tunnelling/)
- [ExtensionTotal VSCode Extensions  2025](https://blog.extensiontotal.com/mining-in-plain-sight-the-vs-code-extension-cryptojacking-campaign-19ca12904b59)
- [Atomic Red Team - T1176.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1176.002)
- [MITRE ATT&CK - T1176.002](https://attack.mitre.org/techniques/T1176/002)
