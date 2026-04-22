---
name: "CIS Ubuntu 14.04 LTS - 1.5.2 Ensure XD/NX support is enabled"
description: "Verify that XD/NX (Execute Disable/No Execute) CPU protection is enabled to prevent buffer overflow exploitation"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - hardening
cis_id: "1.5.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.5.2 Ensure XD/NX support is enabled (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Recent processors in the x86 family support the ability to prevent code execution on a per memory page basis. Generically and on AMD processors, this ability is called No Execute (NX), while on Intel processors it is called Execute Disable (XD). This ability can help prevent exploitation of buffer overflow vulnerabilities and should be activated whenever possible. Extra steps must be taken to ensure that this protection is enabled, particularly on 32-bit x86 systems. Other processors, such as Itanium and POWER, have included such support since inception and the standard kernel for those platforms supports the feature.

## Rationale

Enabling any feature that can protect against buffer overflow attacks enhances the security of the system.

## Audit Procedure

Run the following command and verify your kernel has identified and activated NX/XD protection:

```bash
dmesg | grep NX
```

## Expected Result

```
NX (Execute Disable) protection: active
```

## Remediation

On 32 bit systems install a kernel with PAE support, no installation is required on 64 bit systems. If necessary configure your bootloader to load the new kernel and reboot the system. You may need to enable NX or XD support in your bios.

## Default Value

Enabled on 64-bit systems by default.

## Notes

Ensure your system supports the XD or NX bit and has PAE support before implementing this recommendation as this may prevent it from booting if these are not supported by your hardware.

## References

- CIS Controls: 8.4 Enable Anti-exploitation Features (i.e. DEP, ASLR, EMET)

## Profile

- Level 1 - Server
- Level 1 - Workstation
