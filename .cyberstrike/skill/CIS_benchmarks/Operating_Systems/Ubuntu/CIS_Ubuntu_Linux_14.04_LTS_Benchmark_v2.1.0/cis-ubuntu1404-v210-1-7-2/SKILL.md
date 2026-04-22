---
name: "CIS Ubuntu 14.04 LTS - 1.7.2 Ensure GDM login banner is configured"
description: "Verify that GDM graphical login banner is configured with appropriate warning message"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - banners
cis_id: "1.7.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.7.2 Ensure GDM login banner is configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

GDM is the GNOME Display Manager which handles graphical login for GNOME based systems.

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place.

## Audit Procedure

If GDM is installed on the system verify that `/etc/dconf/profile/gdm` exists and contains the following:

```
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
```

Then verify the `banner-message-enable` and `banner-message-text` options are configured in one of the files in the `/etc/dconf/db/gdm.d/` directory:

```
[org/gnome/login-screen]
banner-message-enable=true
banner-message-text='<banner message>'
```

This is typically configured in `/etc/dconf/db/gdm.d/01-banner-message`.

## Expected Result

The dconf profile for GDM should exist with the appropriate database configuration, and the banner message should be enabled with an appropriate warning text.

## Remediation

Create the `/etc/dconf/profile/gdm` file with the following contents:

```
user-db:user
system-db:gdm
file-db:/usr/share/gdm/greeter-dconf-defaults
```

Create or edit the `banner-message-enable` and `banner-message-text` options in `/etc/dconf/db/gdm.d/01-banner-message`:

```
[org/gnome/login-screen]
banner-message-enable=true
banner-message-text='Authorized uses only. All activity may be monitored and reported.'
```

Run the following command to update the system databases:

```bash
dconf update
```

## Default Value

No GDM banner is configured by default.

## Notes

Additional options and sections may appear in the `/etc/dconf/db/gdm.d/01-banner-message` file. If a different GUI login service is in use, consult your documentation and apply an equivalent banner.

## References

- CIS Controls: Warning banners section

## Profile

- Level 1 - Server
- Level 1 - Workstation
