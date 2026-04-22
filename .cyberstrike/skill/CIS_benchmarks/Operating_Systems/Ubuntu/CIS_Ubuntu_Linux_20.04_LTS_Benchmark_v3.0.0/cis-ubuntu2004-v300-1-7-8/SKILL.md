---
name: cis-ubuntu2004-v300-1-7-8
description: "Ensure GDM autorun-never is enabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, autorun, removable-media]
cis_id: "1.7.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.8 Ensure GDM autorun-never is enabled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `autorun-never` setting allows the GNOME Desktop Display Manager to disable autorun through GDM.

## Rationale

Malware on removable media may taking advantage of Autorun features when the media is inserted into a system and execute.

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

Run the following command to verify that `autorun-never` is set to `true` for GDM:

```bash
# gsettings get org.gnome.desktop.media-handling autorun-never
true
```

## Expected Result

`autorun-never` should be set to `true`.

## Remediation

### Command Line

- IF - A user profile exist run the following command to set `autorun-never` to `true` for GDM users:

```bash
# gsettings set org.gnome.desktop.media-handling autorun-never true
```

Note:
- `gsettings` commands in this section MUST be done from a command window on a graphical desktop or an error will be returned.
- The system must be restarted after all `gsettings` configurations have been set in order for CIS-CAT Assessor to appropriately assess.

- OR/IF - A user profile does not exist:

1. create the file `/etc/dconf/db/local.d/locks/00-media-autorun` with the following content:

```
[org/gnome/desktop/media-handling]
autorun-never=true
```

2. Update the systems databases:

```bash
# dconf update
```

Note: Users must log out and back in again before the system-wide settings take effect.

## Default Value

false

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 10.3 Disable Autorun and Autoplay for Removable Media | * | * | * |
| v7 | 8.5 Configure Devices Not To Auto-run Content | * | * | * |

MITRE ATT&CK Mappings: T1091, T1091.000 | TA0001, TA0008 | M1042
