---
name: cis-ubuntu2004-v300-1-7-6
description: "Ensure GDM automatic mounting of removable media is disabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, removable-media, automount]
cis_id: "1.7.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.6 Ensure GDM automatic mounting of removable media is disabled (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

By default GNOME automatically mounts removable media when inserted as a convenience to the user.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Impact

The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations is considered adequate there is little value add in turning off automounting.

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

Run the following commands to verify automatic mounting is disabled:

```bash
# gsettings get org.gnome.desktop.media-handling automount
false
# gsettings get org.gnome.desktop.media-handling automount-open
false
```

## Expected Result

Both `automount` and `automount-open` should be `false`.

## Remediation

### Command Line

- IF - A user profile exists run the following commands to ensure automatic mounting is disabled:

```bash
# gsettings set org.gnome.desktop.media-handling automount false
# gsettings set org.gnome.desktop.media-handling automount-open false
```

Note:
- `gsettings` commands in this section MUST be done from a command window on a graphical desktop or an error will be returned.
- The system must be restarted after all `gsettings` configurations have been set in order for CIS-CAT Assessor to appropriately assess.

- OR/IF - A user profile does not exist:

1. Create a file `/etc/dconf/db/local.d/00-media-automount` with following content:

```
[org/gnome/desktop/media-handling]
automount=false
automount-open=false
```

2. After creating the file, apply the changes using below command:

```bash
# dconf update
```

Note: Users must log out and back in again before the system-wide settings take effect.

## References

1. https://access.redhat.com/solutions/20107
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 10.3 Disable Autorun and Autoplay for Removable Media | * | * | * |
| v7 | 8.5 Configure Devices Not To Auto-run Content | * | * | * |

MITRE ATT&CK Mappings: T1091, T1091.000 | TA0008 | M1042
