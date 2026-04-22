---
name: cis-ubuntu2004-v300-1-7-3
description: "Ensure GDM disable-user-list option is enabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, user-list, login]
cis_id: "1.7.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.3 Ensure GDM disable-user-list option is enabled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

GDM is the GNOME Display Manager which handles graphical login for GNOME based systems.

The `disable-user-list` option controls if a list of users is displayed on the login screen.

## Rationale

Displaying the user list eliminates half of the Userid/Password equation that an unauthorized person would need to log on.

## Audit Procedure

### Command Line

Run the following command to verify that a user profile exists:

```bash
# grep -Psi "user-db|system-db" /etc/dconf/profile/*/*
```

```
/etc/dconf/profile/local:user-db:user
/etc/dconf/profile/local:system-db:local
```

Run the following command and to verify that the `disable-user-list` option is enabled:

```bash
# gsettings get org.gnome.login-screen disable-user-list
true
```

## Expected Result

- A user profile should exist
- `disable-user-list` should be `true`

## Remediation

### Command Line

- IF - A user profile exists run the following command to enable the `disable-user-list`:

```bash
# gsettings set org.gnome.login-screen disable-user-list true
```

Note:
- `gsettings` commands in this section MUST be done from a command window on a graphical desktop or an error will be returned.
- The system must be restarted after all `gsettings` configurations have been set in order for CIS-CAT Assessor to appropriately assess.

- OR/IF - A user profile does not exist:

1. Create or edit the gdm profile in `/etc/dconf/profile/gdm` with the following lines:

```
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
```

Note: gdm is the name of a dconf database.

2. Create a gdm keyfile for machine-wide settings in `/etc/dconf/db/gdm.d/00-login-screen`:

```
[org/gnome/login-screen]
# Do not show the user list
disable-user-list=true
```

3. Update the system databases:

```bash
# dconf update
```

Note: When the user profile is created or changed, the user will need to log out and log in again before the changes will be applied.

## Default Value

false

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/login-userlist-disable.html.en
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## Additional Information

If a different GUI login service is in use and required on the system, consult your documentation to disable displaying the user list.

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.002, T1078.003, T1087, T1087.001, T1087.002 | TA0007 | M1028
