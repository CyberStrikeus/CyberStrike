---
name: cis-ubuntu1204-v110-3-3
description: "Set Boot Loader Password"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, boot, grub, password, authentication]
cis_id: "3.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3 Set Boot Loader Password (Scored)

## Profile Applicability
- Level 1

## Description
Setting the boot loader password will require that anyone rebooting the system must enter a password before being able to set command line boot parameters.

## Rationale
Requiring a boot password upon execution of the boot loader will prevent an unauthorized user from entering boot parameters or changing the boot partition. This prevents users from weakening security (e.g. turning off SELinux at boot time).

## Audit Procedure
### Using Command Line
Perform the following to determine if a password is required to set command line boot parameters:
```bash
grep "^set superusers" /boot/grub/grub.cfg
grep "^password" /boot/grub/grub.cfg
```

## Expected Result
The first command should return: `set superusers="<user-list>"`
The second command should return: `password_pbkdf2 <user> <encrypted password>`
At least one user must be specified as a super user and have a password assigned.

## Remediation
### Using Command Line
Create an encrypted password with grub-mkpasswd-pbkdf2:
```bash
grub-mkpasswd-pbkdf2
```

Add the following into `/etc/grub.d/00_header` or a custom `/etc/grub.d` configuration file:
```
cat <<EOF
set superusers="<user-list>"
password_pbkdf2 <user> <encrypted-password>
EOF
```

Run the following to update the grub configuration:
```bash
update-grub
```

## Default Value
By default, no boot loader password is set.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
