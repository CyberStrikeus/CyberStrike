---
name: "CIS Ubuntu 14.04 LTS - 1.6.1.1 Ensure SELinux is not disabled in bootloader configuration"
description: "Verify that SELinux is not disabled via GRUB bootloader parameters"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - mac
cis_id: "1.6.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with:
  - cis-ubuntu1404-v210-1-6-1-2
  - cis-ubuntu1404-v210-1-6-1-3
prerequisites: []
severity_boost: "high"
---

# 1.6.1.1 Ensure SELinux is not disabled in bootloader configuration (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Configure SELINUX to be enabled at boot time and verify that it has not been overwritten by the grub boot parameters.

## Rationale

SELinux must be enabled at boot time in your grub configuration to ensure that the controls it provides are not overridden.

## Audit Procedure

Run the following command and verify that no linux line has the `selinux=0` or `enforcing=0` parameters set:

```bash
grep "^\s*linux" /boot/grub/grub.cfg
```

## Expected Result

No linux lines should contain `selinux=0` or `enforcing=0`.

## Remediation

Edit `/etc/default/grub` and remove all instances of `selinux=0` and `enforcing=0` from all CMDLINE_LINUX parameters:

```
GRUB_CMDLINE_LINUX_DEFAULT="quiet"
GRUB_CMDLINE_LINUX=""
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

Not applicable.

## Notes

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

## References

- CIS Controls: 14.4 Protect Information With Access Control Lists

## Profile

- Level 2 - Server
- Level 2 - Workstation
