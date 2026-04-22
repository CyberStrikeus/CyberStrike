---
name: "T1014_rootkit"
description: "Adversaries may use rootkits to hide the presence of programs, files, network connections, services, drivers, and other system components."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1014
  - defense-evasion
  - linux
  - macos
  - windows
technique_id: "T1014"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1014"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1014 Rootkit

## High-Level Description

Adversaries may use rootkits to hide the presence of programs, files, network connections, services, drivers, and other system components. Rootkits are programs that hide the existence of malware by intercepting/hooking and modifying operating system API calls that supply system information.

Rootkits or rootkit enabling functionality may reside at the user or kernel level in the operating system or lower, to include a hypervisor or System Firmware. Rootkits have been seen for Windows, Linux, and Mac OS X systems.

Rootkits that reside or modify boot sectors are known as Bootkits and specifically target the boot process of the operating system.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Rootkit technique is applicable to target environment
- [ ] Check Linux systems for indicators of Rootkit
- [ ] Check macOS systems for indicators of Rootkit
- [ ] Check Windows systems for indicators of Rootkit
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Loadable Kernel Module based Rootkit

Loadable Kernel Module based Rootkit

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo insmod #{rootkit_path}/#{rootkit_name}.ko
```

**Dependencies:**

- The kernel module must exist on disk at specified location (#{rootkit_path}/#{rootkit_name}.ko)

### Atomic Test 2: Loadable Kernel Module based Rootkit

Loadable Kernel Module based Rootkit

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo modprobe #{rootkit_name}
```

**Dependencies:**

- The kernel module must exist on disk at specified location (#{rootkit_source_path}/#{rootkit_name}.ko)

### Atomic Test 3: dynamic-linker based rootkit (libprocesshider)

Uses libprocesshider to simulate rootkit behavior by hiding a specific process name via ld.so.preload (see also T1574.006).

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo #{library_path} | tee -a /etc/ld.so.preload
/usr/local/bin/evil_script.py localhost -c 10 >/dev/null & pgrep -l evil_script.py || echo "process hidden"
```

**Dependencies:**

- The preload library must exist on disk at specified location (#{library_path})

### Atomic Test 4: Loadable Kernel Module based Rootkit (Diamorphine)

Loads Diamorphine kernel module, which hides itself and a processes.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo modprobe #{rootkit_name}
ping -c 10 localhost >/dev/null & TARGETPID="$!"
ps $TARGETPID
kill -31 $TARGETPID
ps $TARGETPID || echo "process ${TARGETPID} hidden"
```

**Dependencies:**

- The kernel module must exist on disk at specified location (#{rootkit_name}.ko)

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Rootkit by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Kernel/User-Level Rootkit Behavior Across Platforms

## Risk Assessment

| Finding                      | Severity | Impact          |
| ---------------------------- | -------- | --------------- |
| Rootkit technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [CrowdStrike Linux Rootkit](https://www.crowdstrike.com/blog/http-iframe-injecting-linux-rootkit/)
- [BlackHat Mac OSX Rootkit](http://www.blackhat.com/docs/asia-14/materials/Tsai/WP-Asia-14-Tsai-You-Cant-See-Me-A-Mac-OS-X-Rootkit-Uses-The-Tricks-You-Havent-Known-Yet.pdf)
- [Symantec Windows Rootkits](https://www.symantec.com/avcenter/reference/windows.rootkit.overview.pdf)
- [Wikipedia Rootkit](https://en.wikipedia.org/wiki/Rootkit)
- [Atomic Red Team - T1014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1014)
- [MITRE ATT&CK - T1014](https://attack.mitre.org/techniques/T1014)
