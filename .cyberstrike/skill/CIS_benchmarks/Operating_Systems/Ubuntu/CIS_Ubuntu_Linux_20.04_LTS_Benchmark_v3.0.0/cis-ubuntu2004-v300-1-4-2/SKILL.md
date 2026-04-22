---
name: cis-ubuntu2004-v300-1-4-2
description: "Ensure access to bootloader config is configured"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, bootloader, grub, permissions]
cis_id: "1.4.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.2 Ensure access to bootloader config is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The grub configuration file contains information on boot settings and passwords for unlocking boot options.

## Rationale

Setting the permissions to read and write for root only prevents non-root users from seeing the boot parameters or changing them. Non-root users who read the boot parameters may be able to identify weaknesses in security upon boot and be able to exploit them.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `0600` or more restrictive:

```bash
# stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /boot/grub/grub.cfg
```

```
Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Expected Result

Access should be `0600` or more restrictive, Uid and Gid should both be `0/root`.

## Remediation

### Command Line

Run the following commands to set permissions on your grub configuration:

```bash
# chown root:root /boot/grub/grub.cfg
# chmod u-x,go-rwx /boot/grub/grub.cfg
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3

## Additional Information

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1542, T1542.000 | TA0005, TA0007 | M1022
