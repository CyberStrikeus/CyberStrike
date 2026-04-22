---
name: cis-ubuntu1604-v200-1-5-1
description: "Ensure XD/NX support is enabled"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, xd, nx, buffer-overflow, kernel, hardening]
cis_id: "1.5.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.5.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Recent processors in the x86 family support the ability to prevent code execution on a per memory page basis. Generically and on AMD processors, this ability is called No Execute (NX), while on Intel processors it is called Execute Disable (XD). This ability can help prevent exploitation of buffer overflow vulnerabilities and should be activated whenever possible. Extra steps must be taken to ensure that this protection is enabled, particularly on 32-bit x86 systems. Other processors, such as Itanium and POWER, have included such support since inception and the standard kernel for those platforms supports the feature.

_Note: Ensure your system supports the XD or NX bit and has PAE support before implementing this recommendation as this may prevent it from booting if these are not supported by your hardware._

## Rationale

Enabling any feature that can protect against buffer overflow attacks enhances the security of the system.

## Audit Procedure

### Command Line

Run the following command and verify your kernel has identified and activated NX/XD protection:

```bash
journalctl | grep 'protection: active'
```

Expected output: `kernel: NX (Execute Disable) protection: active`

**OR** on systems without journalctl:

```bash
[[ -n $(grep noexec[0-9]*=off /proc/cmdline) || -z $(grep -E -i ' (pae|nx) ' /proc/cpuinfo) || -n $(grep '\sNX\s.*\sprotection:\s' /var/log/dmesg | grep -v active) ]] && echo "NX Protection is not active"
```

Nothing should be returned.

## Expected Result

NX/XD protection should be reported as active.

## Remediation

### Command Line

On 32 bit systems install a kernel with PAE support, no installation is required on 64 bit systems.

If necessary configure your bootloader to load the new kernel and reboot the system. You may need to enable NX or XD support in your bios.

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features/ Deploy Anti-Exploit Technologies |

## Assessment Status

Manual
