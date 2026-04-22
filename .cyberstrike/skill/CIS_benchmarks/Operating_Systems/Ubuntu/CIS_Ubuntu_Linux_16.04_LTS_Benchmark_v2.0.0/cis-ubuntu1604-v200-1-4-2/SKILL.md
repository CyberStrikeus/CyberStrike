---
name: cis-ubuntu1604-v200-1-4-2
description: "Ensure bootloader password is set"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, bootloader, grub, password, secure-boot]
cis_id: "1.4.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.4.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Setting the boot loader password will require that anyone rebooting the system must enter a password before being able to set command line boot parameters.

## Rationale

Requiring a boot password upon execution of the boot loader will prevent an unauthorized user from entering boot parameters or changing the boot partition. This prevents users from weakening security (e.g. turning off AppArmor at boot time).

## Impact

If password protection is enabled, only the designated superuser can edit a Grub 2 menu item by pressing "e" or access the GRUB 2 command line by pressing "c".

If GRUB 2 is set up to boot automatically to a password-protected menu entry the user has no option to back out of the password prompt to select another menu entry. Holding the SHIFT key will not display the menu in this case. The user must enter the correct username and password. If unable, the configuration files will have to be edited via the LiveCD or other means to fix the problem.

You can add `--unrestricted` to the menu entries to allow the system to boot without entering a password. Password will still be required to edit menu items.

More Information: https://help.ubuntu.com/community/Grub2/Passwords

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
grep "^set superusers" /boot/grub/grub.cfg
```

Expected output: `set superusers="<username>"`

```bash
grep "^password" /boot/grub/grub.cfg
```

Expected output: `password_pbkdf2 <username> <encrypted-password>`

## Expected Result

The `set superusers` and `password_pbkdf2` lines should be present in `/boot/grub/grub.cfg`.

## Remediation

### Command Line

Create an encrypted password with `grub-mkpasswd-pbkdf2`:

```bash
grub-mkpasswd-pbkdf2
```

```
Enter password: <password>
Reenter password: <password>
PBKDF2 hash of your password is <encrypted-password>
```

Add the following into a custom `/etc/grub.d` configuration file:

```
cat <<EOF
set superusers="<username>"
password_pbkdf2 <username> <encrypted-password>
EOF
```

_The superuser/user information and password should not be contained in the `/etc/grub.d/00_header` file as this file could be overwritten in a package update._

If there is a requirement to be able to boot/reboot without entering the password, edit `/etc/grub.d/10_linux` and add `--unrestricted` to the line `CLASS=`

Example:

```
CLASS="--class gnu-linux --class gnu --class os --unrestricted"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## References

None.

## CIS Controls

| Controls Version | Control                             |
| ---------------- | ----------------------------------- |
| v7               | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
