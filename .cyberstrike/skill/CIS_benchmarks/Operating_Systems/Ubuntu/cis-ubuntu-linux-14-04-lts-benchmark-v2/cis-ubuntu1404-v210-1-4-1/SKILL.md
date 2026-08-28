---
name: "CIS Ubuntu 14.04 LTS - 1.4.1 Ensure permissions on bootloader config are configured"
description: "Verify that permissions on grub bootloader configuration are restricted to root only"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - boot
cis_id: "1.4.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 1.4.1 Ensure permissions on bootloader config are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The grub configuration file contains information on boot settings and passwords for unlocking boot options. The grub configuration is usually `grub.cfg` stored in `/boot/grub`.

## Rationale

Setting the permissions to read and write for root only prevents non-root users from seeing the boot parameters or changing them. Non-root users who read the boot parameters may be able to identify weaknesses in security upon boot and be able to exploit them.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat /boot/grub/grub.cfg
```

## Expected Result

```
Access: (0400/-r--------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

Run the following commands to set permissions on your grub configuration:

```bash
chown root:root /boot/grub/grub.cfg
chmod og-rwx /boot/grub/grub.cfg
```

## Default Value

Not applicable.

## Notes

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

## References

- CIS Controls: 5.1 Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
