---
name: cis-ubuntu1604-v200-1-4-3
description: "Ensure permissions on bootloader config are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, bootloader, grub, permissions, file-permissions]
cis_id: "1.4.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.4.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The grub configuration file contains information on boot settings and passwords for unlocking boot options.

## Rationale

Setting the permissions to read and write for root only prevents non-root users from seeing the boot parameters or changing them. Non-root users who read the boot parameters may be able to identify weaknesses in security upon boot and be able to exploit them.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `0400` or more restrictive:

```bash
stat /boot/grub/grub.cfg
```

Expected output:

```
Access: (0400/-r--------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Expected Result

`/boot/grub/grub.cfg` should be owned by root:root with permissions 0400 or more restrictive.

## Remediation

### Command Line

Run the following commands to set permissions on your grub configuration:

```bash
chown root:root /boot/grub/grub.cfg
chmod u-wx,go-rwx /boot/grub/grub.cfg
```

## Additional Information

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
