---
name: "T1574.006_dynamic-linker-hijacking"
description: "Adversaries may execute their own malicious payloads by hijacking environment variables the dynamic linker uses to load shared libraries."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.006
  - persistence
  - privilege-escalation
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1574.006"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1574/006"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
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
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.006 Dynamic Linker Hijacking

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking environment variables the dynamic linker uses to load shared libraries. During the execution preparation phase of a program, the dynamic linker loads specified absolute paths of shared libraries from various environment variables and files, such as <code>LD_PRELOAD</code> on Linux or <code>DYLD_INSERT_LIBRARIES</code> on macOS. Libraries specified in environment variables are loaded first, taking precedence over system libraries with the same function name. Each platform's linker uses an extensive list of environment variables at different points in execution. These variables are often used by developers to debug binaries without needing to recompile, deconflict mapped symbols, and implement custom functions in the original library.

Hijacking dynamic linker variables may grant access to the victim process's memory, system/network resources, and possibly elevated privileges. On Linux, adversaries may set <code>LD_PRELOAD</code> to point to malicious libraries that match the name of legitimate libraries which are requested by a victim program, causing the operating system to load the adversary's malicious code upon execution of the victim program. For example, adversaries have used `LD_PRELOAD` to inject a malicious library into every descendant process of the `sshd` daemon, resulting in execution under a legitimate process. When the executing sub-process calls the `execve` function, for example, the malicious library’s `execve` function is executed rather than the system function `execve` contained in the system library on disk. This allows adversaries to Hide Artifacts from detection, as hooking system functions such as `execve` and `readdir` enables malware to scrub its own artifacts from the results of commands such as `ls`, `ldd`, `iptables`, and `dmesg`.

Hijacking dynamic linker variables may grant access to the victim process's memory, system/network resources, and possibly elevated privileges.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Dynamic Linker Hijacking technique is applicable to target environment
- [ ] Check Linux systems for indicators of Dynamic Linker Hijacking
- [ ] Check macOS systems for indicators of Dynamic Linker Hijacking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Shared Library Injection via /etc/ld.so.preload

This test adds a shared library to the `ld.so.preload` list to execute and intercept API calls. This technique was used by threat actor Rocke during the exploitation of Linux web servers. This requires the `glibc` package.

Upon successful execution, bash will echo `../bin/T1574.006.so` to /etc/ld.so.preload.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sh -c 'echo #{path_to_shared_library} > /etc/ld.so.preload'
```

**Dependencies:**
- The shared library must exist on disk at specified location (#{path_to_shared_library})

### Atomic Test 2: Shared Library Injection via LD_PRELOAD

This test injects a shared object library via the LD_PRELOAD environment variable to execute. This technique was used by threat actor Rocke during the exploitation of Linux web servers. This requires the `glibc` package.

Upon successful execution, bash will utilize LD_PRELOAD to load the shared object library `/etc/ld.so.preload`. Output will be via stdout.

**Supported Platforms:** linux

```bash
LD_PRELOAD=#{path_to_shared_library} ls
```

**Dependencies:**
- The shared library must exist on disk at specified location (#{path_to_shared_library})

### Atomic Test 3: Dylib Injection via DYLD_INSERT_LIBRARIES

injects a dylib that opens calculator via env variable

**Supported Platforms:** macos

```bash
DYLD_INSERT_LIBRARIES=#{dylib_file} #{file_to_inject}
```

**Dependencies:**
- Compile the dylib from (#{source_file}). Destination is #{dylib_file}


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dynamic Linker Hijacking by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration
When System Integrity Protection (SIP) is enabled in macOS, the aforementioned environment variables are ignored when executing protected binaries. Third-party applications can also leverage Apple’s Hardened Runtime, ensuring these environment variables are subject to imposed restrictions. Admins can add restrictions to applications by setting the setuid and/or setgid bits, use entitlements, or have a __RESTRICT segment in the Mach-O binary.

### M1038 Execution Prevention
Adversaries may use new payloads to execute this technique. Identify and block potentially malicious software executed through hijacking by using application control solutions also capable of blocking libraries loaded by legitimate software.


## Detection

### Detection Strategy for Hijack Execution Flow: Dynamic Linker Hijacking


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Dynamic Linker Hijacking technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Apple Doco Archive Dynamic Libraries](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/DynamicLibraries/100-Articles/OverviewOfDynamicLibraries.html)
- [Baeldung LD_PRELOAD](https://www.baeldung.com/linux/ld_preload-trick-what-is)
- [TheEvilBit DYLD_INSERT_LIBRARIES](https://theevilbit.github.io/posts/dyld_insert_libraries_dylib_injection_in_macos_osx_deep_dive/)
- [Intezer Symbiote 2022](https://intezer.com/blog/research/new-linux-threat-symbiote/)
- [Gabilondo DYLD_INSERT_LIBRARIES Catalina Bypass](https://jon-gabilondo-angulo-7635.medium.com/how-to-inject-code-into-mach-o-apps-part-ii-ddb13ebc8191)
- [Man LD.SO](https://www.man7.org/linux/man-pages/man8/ld.so.8.html)
- [Elastic Security Labs Pumakit 2024](https://www.elastic.co/security-labs/declawing-pumakit)
- [TLDP Shared Libraries](https://www.tldp.org/HOWTO/Program-Library-HOWTO/shared-libraries.html)
- [Timac DYLD_INSERT_LIBRARIES](https://blog.timac.org/2012/1218-simple-code-injection-using-dyld_insert_libraries/)
- [ESET Ebury Oct 2017](https://www.welivesecurity.com/2017/10/30/windigo-ebury-update-2/)
- [Atomic Red Team - T1574.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.006)
- [MITRE ATT&CK - T1574.006](https://attack.mitre.org/techniques/T1574/006)
