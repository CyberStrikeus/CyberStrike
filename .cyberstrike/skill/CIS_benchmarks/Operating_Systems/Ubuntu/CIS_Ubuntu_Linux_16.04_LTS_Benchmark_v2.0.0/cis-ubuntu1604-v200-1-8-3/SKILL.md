---
name: cis-ubuntu1604-v200-1-8-3
description: "Ensure disable-user-list is enabled"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, gdm, gnome, user-list, login, display-manager]
cis_id: "1.8.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.8.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

GDM is the GNOME Display Manager which handles graphical login for GNOME based systems.

The `disable-user-list` option controls is a list of users is displayed on the login screen.

## Rationale

Displaying the user list eliminates half of the Userid/Password equation that an unauthorized person would need to log on.

## Audit Procedure

### Command Line

Run the following command to verify that disable-user-list is enabled:

```bash
grep -E '^\s*disable-user-list\s*=\s*true\b' /etc/gdm3/greeter.dconf-defaults
```

Expected output: `disable-user-list=true`

## Expected Result

The `disable-user-list` option should be set to `true` in the GDM configuration.

## Remediation

### Command Line

Edit or create the file `/etc/gdm3/greeter.dconf-defaults` and edit or add the following:

```
[org/gnome/login-screen]
banner-message-enable=true
banner-message-text='<banner message>'
disable-user-list=true
```

Run the following command to re-load GDM on the next login or reboot:

```bash
dpkg-reconfigure gdm3
```

## Additional Information

If a different GUI login service is in use and required on the system, consult your documentation to disable displaying the user list.

## Default Value

false

## References

None.

## CIS Controls

| Controls Version | Control                             |
| ---------------- | ----------------------------------- |
| v7               | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
