---
name: "T1574.004_dylib-hijacking"
description: "Adversaries may execute their own payloads by placing a malicious dynamic library (dylib) with an expected name in a path a victim application searches at runtime."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.004
  - persistence
  - privilege-escalation
  - defense-evasion
  - macos
  - sub-technique
technique_id: "T1574.004"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1574/004"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.008
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.005: "Chain with T1574.005 for deeper attack path"
---

# T1574.004 Dylib Hijacking

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own payloads by placing a malicious dynamic library (dylib) with an expected name in a path a victim application searches at runtime. The dynamic loader will try to find the dylibs based on the sequential order of the search paths. Paths to dylibs may be prefixed with <code>@rpath</code>, which allows developers to use relative paths to specify an array of search paths used at runtime based on the location of the executable. Additionally, if weak linking is used, such as the <code>LC_LOAD_WEAK_DYLIB</code> function, an application will still execute even if an expected dylib is not present. Weak linking enables developers to run an application on multiple macOS versions as new APIs are added.

Adversaries may gain execution by inserting malicious dylibs with the name of the missing dylib in the identified path. Dylibs are loaded into an application's address space allowing the malicious dylib to inherit the application's privilege level and resources. Based on the application, this could result in privilege escalation and uninhibited network access. This method may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** macOS

## What to Check

- [ ] Identify if Dylib Hijacking technique is applicable to target environment
- [ ] Check macOS systems for indicators of Dylib Hijacking
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dylib Hijacking by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Set directory access controls to prevent file writes to the search paths for applications, both in the folders where applications are run from and the standard dylib folders.

## Detection

### Detection Strategy for Hijack Execution Flow: Dylib Hijacking

## Risk Assessment

| Finding                              | Severity | Impact      |
| ------------------------------------ | -------- | ----------- |
| Dylib Hijacking technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [MalwareUnicorn macOS Dylib Injection MachO](https://malwareunicorn.org/workshops/macos_dylib_injection.html#5)
- [Apple Developer Doco Archive Run-Path](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/DynamicLibraries/100-Articles/RunpathDependentLibraries.html)
- [Wardle Dylib Hijacking OSX 2015](https://www.virusbulletin.com/uploads/pdf/magazine/2015/vb201503-dylib-hijacking.pdf)
- [Writing Bad Malware for OSX](https://www.blackhat.com/docs/us-15/materials/us-15-Wardle-Writing-Bad-A-Malware-For-OS-X.pdf)
- [Wardle Dylib Hijack Vulnerable Apps](https://objective-see.com/blog/blog_0x46.html)
- [wardle artofmalware volume1](https://taomm.org/vol1/read.html)
- [Github EmpireProject HijackScanner](https://github.com/EmpireProject/Empire/blob/master/lib/modules/python/situational_awareness/host/osx/HijackScanner.py)
- [Github EmpireProject CreateHijacker Dylib](https://github.com/EmpireProject/Empire/blob/08cbd274bef78243d7a8ed6443b8364acd1fc48b/lib/modules/python/persistence/osx/CreateHijacker.py)
- [Atomic Red Team - T1574.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.004)
- [MITRE ATT&CK - T1574.004](https://attack.mitre.org/techniques/T1574/004)
