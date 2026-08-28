---
name: cis-ubuntu2004-v300-1-7-2
description: "Ensure GDM login banner is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, banner, login]
cis_id: "1.7.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.2 Ensure GDM login banner is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

GDM is the GNOME Display Manager which handles graphical login for GNOME based systems.

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place.

## Audit Procedure

### Command Line

Run the following command to verify that a user profile exists:

```bash
# grep -Psi "user-db|system-db" /etc/dconf/profile/*/*
```

```
/etc/dconf/profile/gdm:user-db:user
/etc/dconf/profile/gdm:system-db:local
```

Run the following commands to verify that the text banner on the login screen is enabled and set:

```bash
# gsettings get org.gnome.login-screen banner-message-enable
true
# gsettings get org.gnome.login-screen banner-message-text
'Authorized uses only. All activity may be monitored and reported'
```

## Expected Result

- A user profile should exist with user-db and system-db entries
- `banner-message-enable` should be `true`
- `banner-message-text` should be set according to site policy

## Remediation

### Command Line

- IF - A user profile is already created run the following commands to set and enable the text banner message on the login screen:

```bash
# gsettings set org.gnome.login-screen banner-message-text 'Authorized uses only. All activity may be monitored and reported'
# gsettings set org.gnome.login-screen banner-message-enable true
```

Note:

- `banner-message-text` may be set in accordance with local site policy
- `gsettings` commands in this section MUST be done from a command window on a graphical desktop or an error will be returned.
- The system must be restarted after all `gsettings` configurations have been set in order for CIS-CAT Assessor to appropriately assess.

- OR/IF - A user profile does not exist:

1. Create or edit the gdm profile in the `/etc/dconf/profile/gdm` with the following lines:

```
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
```

Note: gdm is the name of a dconf database.

2. Create a gdm keyfile for machine-wide settings in `/etc/dconf/db/gdm.d/01-banner-message`:

```
[org/gnome/login-screen]
banner-message-enable=true
banner-message-text='Type the banner message here.'
```

3. Update the system databases:

```bash
# dconf update
```

Note:

- Users must log out and back in again before the system-wide settings take effect.
- There is no character limit for the banner message. gnome-shell autodetects longer stretches of text and enters two column mode.
- The banner message cannot be read from an external file.

## Default Value

disabled

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/login-banner.html.en
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## Additional Information

Additional options and sections may appear in the `/etc/dconf/db/gdm.d/01-banner-message` file.

If a different GUI login service is in use, consult your documentation and apply an equivalent banner.

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.002, T1078.003, T1087, T1087.001, T1087.002 | TA0007 | M1028
