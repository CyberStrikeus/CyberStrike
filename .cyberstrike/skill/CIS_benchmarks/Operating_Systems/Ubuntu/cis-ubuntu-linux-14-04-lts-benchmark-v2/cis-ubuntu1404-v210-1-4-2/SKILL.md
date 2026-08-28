---
name: "CIS Ubuntu 14.04 LTS - 1.4.2 Ensure bootloader password is set"
description: "Verify that a bootloader password is set to prevent unauthorized boot parameter changes"
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
cis_id: "1.4.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 1.4.2 Ensure bootloader password is set (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Setting the boot loader password will require that anyone rebooting the system must enter a password before being able to set command line boot parameters.

## Rationale

Requiring a boot password upon execution of the boot loader will prevent an unauthorized user from entering boot parameters or changing the boot partition. This prevents users from weakening security (e.g. turning off SELinux at boot time).

## Audit Procedure

Run the following commands and verify output matches:

```bash
grep "^set superusers" /boot/grub/grub.cfg
grep "^password" /boot/grub/grub.cfg
```

## Expected Result

```
set superusers="<username>"
password_pbkdf2 <username> <encrypted-password>
```

## Remediation

Create an encrypted password with `grub-mkpasswd-pbkdf2`:

```bash
grub-mkpasswd-pbkdf2
```

Add the following into `/etc/grub.d/00_header` or a custom `/etc/grub.d` configuration file:

```
cat <<EOF
set superusers="<username>"
password_pbkdf2 <username> <encrypted-password>
EOF
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

No bootloader password is set by default.

## Notes

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

## References

- CIS Controls: 5.1 Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
