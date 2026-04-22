---
name: cis-ubuntu1804-v220-1-4-2
description: "Ensure permissions on bootloader config are configured"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, grub, bootloader, permissions, secure-boot]
cis_id: "1.4.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.2 Ensure permissions on bootloader config are configured (Automated)

## Profile Applicability

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
stat /boot/grub/grub.cfg
```

## Expected Result

```
Access: (0600/-r--------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

### Command Line

Run the following commands to set permissions on your grub configuration:

```bash
chown root:root /boot/grub/grub.cfg
chmod u-x,go-rwx /boot/grub/grub.cfg
```

## Additional Information

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1542, T1542.000 | TA0005, TA0007 | M1022 |
