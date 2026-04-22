---
name: "T1036.006_space-after-filename"
description: "Adversaries can hide a program's true filetype by changing the extension of a file."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.006
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1036.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1036/006"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.006 Space after Filename

> **Sub-technique of:** T1036

## High-Level Description

Adversaries can hide a program's true filetype by changing the extension of a file. With certain file types (specifically this does not work with .app extensions), appending a space to the end of a filename will change how the file is processed by the operating system.

For example, if there is a Mach-O executable file called <code>evil.bin</code>, when it is double clicked by a user, it will launch Terminal.app and execute. If this file is renamed to <code>evil.txt</code>, then when double clicked by a user, it will launch with the default text editing application (not executing the binary). However, if the file is renamed to <code>evil.txt </code> (note the space at the end), then when double clicked by a user, the true file type is determined by the OS and handled appropriately and the binary will be executed .

Adversaries can use this feature to trick users into double clicking benign-looking files of any format and ultimately executing something malicious.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Space after Filename technique is applicable to target environment
- [ ] Check Linux systems for indicators of Space after Filename
- [ ] Check macOS systems for indicators of Space after Filename
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Space After Filename (Manual)

Space After Filename

**Supported Platforms:** macos

### Atomic Test 2: Space After Filename

Space after filename.

**Supported Platforms:** macos, linux

```bash
mkdir -p /tmp/atomic-test-T1036.006
cd /tmp/atomic-test-T1036.006
mkdir -p 'testdirwithspaceend '
[ "$(uname)" = 'FreeBSD' ] && /bin/echo "#\!/bin/sh" > "testdirwithspaceend /init " && echo 'echo "print(\"running T1035.006 with space after filename to masquerade init\")" | python3.9' >> "testdirwithspaceend /init " && echo "exit" >> "testdirwithspaceend /init " || /usr/bin/echo -e "%d\na\n#!/usr/bin/perl\nprint \"running T1035.006 with space after filename to masquerade init\\n\";\nqx/cp \/usr\/bin\/perl 'init  '/;\nqx/'.\/init  ' -e 'sleep 5'/;\n.\nwq\n" | ed 'testdirwithspaceend /init ' >/dev/null
chmod +x 'testdirwithspaceend /init '
'./testdirwithspaceend /init '
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Space after Filename by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Masquerading via Space After Filename - Behavioral Detection Strategy

## Risk Assessment

| Finding                                   | Severity | Impact          |
| ----------------------------------------- | -------- | --------------- |
| Space after Filename technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Mac Backdoors are back](https://arstechnica.com/security/2016/07/after-hiatus-in-the-wild-mac-backdoors-are-suddenly-back/)
- [Atomic Red Team - T1036.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.006)
- [MITRE ATT&CK - T1036.006](https://attack.mitre.org/techniques/T1036/006)
