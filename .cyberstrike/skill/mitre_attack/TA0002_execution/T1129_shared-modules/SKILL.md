---
name: "T1129_shared-modules"
description: "Adversaries may execute malicious payloads via loading shared modules."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1129
  - execution
  - linux
  - macos
  - windows
technique_id: "T1129"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1129"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1129 Shared Modules

## High-Level Description

Adversaries may execute malicious payloads via loading shared modules. Shared modules are executable files that are loaded into processes to provide access to reusable code, such as specific custom functions or invoking OS API functions (i.e., Native API).

Adversaries may use this functionality as a way to execute arbitrary payloads on a victim system. For example, adversaries can modularize functionality of their malware into shared objects that perform various functions such as managing C2 network communications or execution of specific actions on objective.

The Linux & macOS module loader can load and execute shared objects from arbitrary local paths. This functionality resides in `dlfcn.h` in functions such as `dlopen` and `dlsym`. Although macOS can execute `.so` files, common practice uses `.dylib` files.

The Windows module loader can be instructed to load DLLs from arbitrary local paths and arbitrary Universal Naming Convention (UNC) network paths. This functionality resides in `NTDLL.dll` and is part of the Windows Native API which is called from functions like `LoadLibrary` at run time.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Shared Modules technique is applicable to target environment
- [ ] Check Linux systems for indicators of Shared Modules
- [ ] Check macOS systems for indicators of Shared Modules
- [ ] Check Windows systems for indicators of Shared Modules
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: ESXi - Install a custom VIB on an ESXi host

An adversary can maintain persistence within an ESXi host by installing malicious vSphere Installation Bundles (VIBs).
[Reference](https://www.mandiant.com/resources/blog/esxi-hypervisors-malware-persistence)

**Supported Platforms:** windows

```cmd
#{pscp_file} -pw #{vm_pass} #{vib_file} #{vm_user}@#{vm_host}:/tmp
echo "" | "#{plink_file}" "#{vm_host}" -ssh  -l "#{vm_user}" -pw "#{vm_pass}" -m "#{vib_install}"
```

**Dependencies:**

- Check if plink and pscp are available.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Shared Modules by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1129 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Identify and block potentially malicious software executed through this technique by using application control tools capable of preventing unknown modules from being loaded.

## Detection

### Behavior-chain, platform-aware detection strategy for T1129 Shared Modules

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| Shared Modules technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [RotaJakiro 2021 netlab360 analysis](https://blog.netlab.360.com/stealth_rotajakiro_backdoor_en/)
- [Apple Dev Dynamic Libraries](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/DynamicLibraries/100-Articles/OverviewOfDynamicLibraries.html)
- [Unit42 OceanLotus 2017](https://unit42.paloaltonetworks.com/unit42-new-improved-macos-backdoor-oceanlotus/)
- [Microsoft DLL](https://learn.microsoft.com/troubleshoot/windows-client/deployment/dynamic-link-library)
- [Linux Shared Libraries](https://tldp.org/HOWTO/Program-Library-HOWTO/shared-libraries.html)
- [Atomic Red Team - T1129](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1129)
- [MITRE ATT&CK - T1129](https://attack.mitre.org/techniques/T1129)
