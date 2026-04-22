---
name: cis-ubuntu2004-v300-1-4-1
description: "Ensure bootloader password is set"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, bootloader, grub, password]
cis_id: "1.4.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.1 Ensure bootloader password is set (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Setting the boot loader password will require that anyone rebooting the system must enter a password before being able to set command line boot parameters.

## Rationale

Requiring a boot password upon execution of the boot loader will prevent an unauthorized user from entering boot parameters or changing the boot partition. This prevents users from weakening security (e.g. turning off AppArmor at boot time).

## Impact

If password protection is enabled, only the designated superuser can edit a GRUB 2 menu item by pressing "e" or access the GRUB 2 command line by pressing "c".

If GRUB 2 is set up to boot automatically to a password-protected menu entry the user has no option to back out of the password prompt to select another menu entry. Holding the SHIFT key will not display the menu in this case. The user must enter the correct username and password. If unable to do so, the configuration files will have to be edited via a LiveCD or other means to fix the problem.

You can add `--unrestricted` to the menu entries to allow the system to boot without entering a password. A password will still be required to edit menu items.

More Information: https://help.ubuntu.com/community/Grub2/Passwords

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
# grep "^set superusers" /boot/grub/grub.cfg
```

```
set superusers="<username>"
```

```bash
# awk -F. '/^\s*password/ {print $1"."$2"."$3}' /boot/grub/grub.cfg
```

```
password_pbkdf2 <username> grub.pbkdf2.sha512
```

## Expected Result

- `set superusers="<username>"` should be present
- `password_pbkdf2 <username> grub.pbkdf2.sha512` should be present

## Remediation

### Command Line

Create an encrypted password with `grub-mkpasswd-pbkdf2`:

```bash
# grub-mkpasswd-pbkdf2 --iteration-count=600000 --salt=64
```

```
Enter password: <password>
Reenter password: <password>
PBKDF2 hash of your password is <encrypted-password>
```

Add the following into a custom `/etc/grub.d` configuration file:

```
set superusers="<username>"
password_pbkdf2 <username> <encrypted-password>
```

The superuser/user information and password should not be contained in the `/etc/grub.d/00_header` file as this file could be overwritten in a package update. If there is a requirement to be able to boot/reboot without entering the password, edit `/etc/grub.d/10_linux` and add `--unrestricted` to the line `CLASS=`

Example:
```
CLASS="--class gnu-linux --class gnu --class os --unrestricted"
```

Run the following command to update the `grub2` configuration:

```bash
# update-grub
```

## Default Value

This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## References

1. NIST SP 800-53 Rev. 5: AC-3
2. NIST SP 800-53A :: AC-3.1

## Additional Information

Changes to `/etc/grub.d/10_linux` may be overwritten during updates to the `grub-common` package. You should review any changes to this file before rebooting otherwise the system may unexpectedly prompt for a password on the next boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1542, T1542.000 | TA0003 | M1046
