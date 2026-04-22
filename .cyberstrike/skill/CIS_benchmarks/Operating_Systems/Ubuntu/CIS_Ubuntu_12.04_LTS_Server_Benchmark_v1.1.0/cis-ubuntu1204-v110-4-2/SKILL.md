---
name: cis-ubuntu1204-v110-4-2
description: "Enable XD/NX Support on 32-bit x86 Systems"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, process-hardening, nx, xd, buffer-overflow, memory-protection]
cis_id: "4.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Enable XD/NX Support on 32-bit x86 Systems (Not Scored)

## Profile Applicability
- Level 1

## Description
Recent processors in the x86 family support the ability to prevent code execution on a per memory page basis. Generically and on AMD processors, this ability is called No Execute (NX), while on Intel processors it is called Execute Disable (XD). This ability can help prevent exploitation of buffer overflow vulnerabilities and should be activated whenever possible. Extra steps must be taken to ensure that this protection is enabled, particularly on 32-bit x86 systems. Other processors, such as Itanium and POWER, have included such support since inception and the standard kernel for those platforms supports the feature.

## Rationale
Enabling any feature that can protect against buffer overflow attacks enhances the security of the system.

## Audit Procedure
### Using Command Line
Run the following to see if your kernel has identified and activated NX/XD protection:
```bash
dmesg | grep NX
```

## Expected Result
The output should contain: `NX (Execute Disable) protection: active`

## Remediation
### Using Command Line
On 32-bit systems install a kernel with PAE support, no installation is required on 64-bit systems:

If necessary configure your bootloader to load the new kernel and reboot the system.

You may need to enable NX or XD support in your BIOS.

## Default Value
On 64-bit systems, NX/XD protection is enabled by default. On 32-bit systems, a PAE-enabled kernel may be required.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
