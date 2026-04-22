---
name: "T1547.006_kernel-modules-and-extensions"
description: "Adversaries may modify the kernel to automatically execute programs on system boot."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.006
  - persistence
  - privilege-escalation
  - macos
  - linux
  - sub-technique
technique_id: "T1547.006"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1547/006"
tech_stack:
  - macos
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.006 Kernel Modules and Extensions

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may modify the kernel to automatically execute programs on system boot. Loadable Kernel Modules (LKMs) are pieces of code that can be loaded and unloaded into the kernel upon demand. They extend the functionality of the kernel without the need to reboot the system. For example, one type of module is the device driver, which allows the kernel to access hardware connected to the system. 

When used maliciously, LKMs can be a type of kernel-mode Rootkit that run with the highest operating system privilege (Ring 0). Common features of LKM based rootkits include: hiding itself, selective hiding of files, processes and network activity, as well as log tampering, providing authenticated backdoors, and enabling root access to non-privileged users.

Kernel extensions, also called kext, are used in macOS to load functionality onto a system similar to LKMs for Linux. Since the kernel is responsible for enforcing security and the kernel extensions run as apart of the kernel, kexts are not governed by macOS security policies. Kexts are loaded and unloaded through <code>kextload</code> and <code>kextunload</code> commands. Kexts need to be signed with a developer ID that is granted privileges by Apple allowing it to sign Kernel extensions. Developers without these privileges may still sign kexts but they will not load unless SIP is disabled. If SIP is enabled, the kext signature is verified before being added to the AuxKC.

Since macOS Catalina 10.15, kernel extensions have been deprecated in favor of System Extensions. However, kexts are still allowed as "Legacy System Extensions" since there is no System Extension for Kernel Programming Interfaces.

Adversaries can use LKMs and kexts to conduct Persistence and/or Privilege Escalation on a system. Examples have been found in the wild, and there are some relevant open source projects as well.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS, Linux

## What to Check

- [ ] Identify if Kernel Modules and Extensions technique is applicable to target environment
- [ ] Check macOS systems for indicators of Kernel Modules and Extensions
- [ ] Check Linux systems for indicators of Kernel Modules and Extensions
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Linux - Load Kernel Module via insmod

This test uses the insmod command to load a kernel module for Linux.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo insmod #{module_path}
```

**Dependencies:**
- The kernel module must exist on disk at specified location

### Atomic Test 2: MacOS - Load Kernel Module via kextload and kmutil

This test uses the kextload and kmutil commands to load and unload a MacOS kernel module.

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
set -x
sudo kextload #{module_path}
kextstat 2>/dev/null | grep SoftRAID
sudo kextunload #{module_path}
sudo kmutil load -p #{module_path}
kextstat 2>/dev/null | grep SoftRAID
sudo kmutil unload -p #{module_path}
```

**Dependencies:**
- The kernel module must exist on disk at specified location

### Atomic Test 3: MacOS - Load Kernel Module via KextManagerLoadKextWithURL()

This test uses the IOKit API to load a kernel module for macOS.
Harcoded to use SoftRAID kext

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo #{exe_path}
kextstat 2>/dev/null | grep SoftRAID
sudo kextunload /Library/Extensions/SoftRAID.kext
```

**Dependencies:**
- The kernel module must exist on disk at specified location


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Kernel Modules and Extensions by examining the target platforms (macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Limit access to the root account and prevent users from loading kernel modules and extensions through proper privilege separation and limiting Privilege Escalation opportunities.

### M1018 User Account Management
Use MDM to disable user's ability to install or approve kernel extensions, and ensure all approved kernel extensions are in alignment with policies specified in <code>com.apple.syspolicy.kernel-extension-policy</code>.

### M1049 Antivirus/Antimalware
Common tools for detecting Linux rootkits include: rkhunter , chrootkit , although rootkits may be designed to evade certain detection tools.

### M1038 Execution Prevention
Application control and software restriction tools, such as SELinux, KSPP, grsecurity MODHARDEN, and Linux kernel tuning can aid in restricting kernel module loading.


## Detection

### Detection Strategy for Kernel Modules and Extensions Autostart Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Kernel Modules and Extensions technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Apple Developer Configuration Profile](https://developer.apple.com/business/documentation/Configuration-Profile-Reference.pdf)
- [Apple Kernel Extension Deprecation](https://developer.apple.com/support/kernel-extensions/)
- [System and kernel extensions in macOS](https://support.apple.com/guide/deployment/system-and-kernel-extensions-in-macos-depa5fb8376f/web)
- [GitHub Reptile](https://github.com/f0rb1dd3n/Reptile)
- [Volatility Phalanx2](https://volatility-labs.blogspot.com/2012/10/phalanx-2-revealed-using-volatility-to.html)
- [iDefense Rootkit Overview](https://www.megasecurity.org/papers/Rootkits.pdf)
- [Linux Loadable Kernel Module Insert and Remove LKMs](https://tldp.org/HOWTO/Module-HOWTO/x197.html)
- [CrowdStrike Linux Rootkit](https://www.crowdstrike.com/blog/http-iframe-injecting-linux-rootkit/)
- [GitHub Diamorphine](https://github.com/m0nad/Diamorphine)
- [Securelist Ventir](https://securelist.com/the-ventir-trojan-assemble-your-macos-spy/67267/)
- [User Approved Kernel Extension Pike’s](https://pikeralpha.wordpress.com/2017/08/29/user-approved-kernel-extension-loading/)
- [Linux Kernel Module Programming Guide](https://tldp.org/LDP/lkmpg/2.4/html/x437.html)
- [Linux Kernel Programming](https://www.tldp.org/LDP/lkmpg/2.4/lkmpg.pdf)
- [Trend Micro Skidmap](https://blog.trendmicro.com/trendlabs-security-intelligence/skidmap-linux-malware-uses-rootkit-capabilities-to-hide-cryptocurrency-mining-payload/)
- [Purves Kextpocalypse 2](https://richard-purves.com/2017/11/09/mdm-and-the-kextpocalypse-2/)
- [RSAC 2015 San Francisco Patrick Wardle](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [Synack Secure Kernel Extension Broken](https://objective-see.org/blog/blog_0x21.html)
- [Wikipedia Loadable Kernel Module](https://en.wikipedia.org/wiki/Loadable_kernel_module#Linux)
- [Atomic Red Team - T1547.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.006)
- [MITRE ATT&CK - T1547.006](https://attack.mitre.org/techniques/T1547/006)
