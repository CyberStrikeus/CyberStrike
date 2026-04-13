---
name: cis-gcp-cos-1.4.2
description: "Ensure XD/NX support is enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, xd-nx, process-hardening, buffer-overflow]
cis_id: "1.4.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.2 Ensure XD/NX support is enabled (Automated)

## Description

The NX bit (no-execute) is a technology used in CPUs to segregate areas of memory for use by either storage of processor instructions or for storage of data. An operating system with support for the NX bit may mark certain areas of memory as non-executable. The processor will then refuse to execute any code residing in these areas of memory. This ability can help prevent exploitation of buffer overflow vulnerabilities and should be activated whenever possible.

Recent processors in the x86 family support the ability to prevent code execution on a per memory page basis. On AMD processors, this ability is called No Execute (NX), on Intel processors it is called Execute Disable (XD) and on ARM processors it is called Execute Never (XN). Extra steps must be taken to ensure that this protection is enabled, particularly on 32-bit x86 systems. Other processors, such as Itanium and POWER, have included such support since inception and the standard kernel for those platforms supports the feature. Starting from ARMv6, the XN bit is supported by default and the kernel cannot disable it. For this reason, this recommend is not applicable for Container-Optimized OS ARM images.

## Rationale

Enabling any feature that can protect against buffer overflow attacks enhances the security of the system.

## Audit Procedure

Run the following command and verify your kernel has identified and activated NX/XD protection:

```bash
# journalctl | grep 'protection: active'

kernel: NX (Execute Disable) protection: active
```

OR on systems without journalctl:

```bash
[[ -n $(grep noexec[0-9]*=off /proc/cmdline) || -z $(grep -E -i ' (pae|nx) ' /proc/cpuinfo) || -n $(grep '\sNX\s.*\sprotection:\s' /var/log/dmesg | grep -v active) ]] && echo "NX Protection is not active"
```

## Expected Result

The output should show `kernel: NX (Execute Disable) protection: active`. Nothing should be returned from the alternative command.

## Remediation

On 32 bit systems install a kernel with PAE support, no installation is required on 64 bit systems. If necessary configure your bootloader to load the new kernel and reboot the system. You may need to enable NX or XD support in your bios.

## Additional Information

Ensure your system supports the XD or NX bit and has PAE support before implementing this recommendation as this may prevent it from booting if these are not supported by your hardware.

## CIS Controls

| Controls Version | Control                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.5 Enable Anti-Exploitation Features                                                  |      | x    | x    |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies |      | x    | x    |

## Profile

Level 1 - Server | Automated
