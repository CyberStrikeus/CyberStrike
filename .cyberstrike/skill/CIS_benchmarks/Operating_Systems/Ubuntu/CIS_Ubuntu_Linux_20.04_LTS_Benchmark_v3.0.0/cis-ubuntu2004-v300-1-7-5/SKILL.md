---
name: cis-ubuntu2004-v300-1-7-5
description: "Ensure GDM screen locks cannot be overridden"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, screen-lock, dconf]
cis_id: "1.7.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.5 Ensure GDM screen locks cannot be overridden (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

GNOME Desktop Manager can lock down specific settings by using the lockdown mode in dconf to prevent users from changing specific settings.

To lock down a dconf key or subpath, create a locks subdirectory in the keyfile directory. The files inside this directory contain a list of keys or subpaths to lock. Just as with the keyfiles, you may add any number of files to this directory.

## Rationale

Setting a lock-out value reduces the window of opportunity for unauthorized user access to another user's session that has been left unattended.

Without locking down the system settings, user settings take precedence over the system settings.

## Audit Procedure

### Command Line

Run the following commands to verify that the screen lock cannot be overridden:

```bash
# grep -Psi "idle-delay|lock-delay|lock-enabled" /etc/dconf/db/*/locks/*
```

```
/org/gnome/desktop/session/idle-delay
/org/gnome/desktop/screensaver/lock-delay
/org/gnome/desktop/screensaver/lock-enabled
```

## Expected Result

All three lock entries should be present: `idle-delay`, `lock-delay`, and `lock-enabled`.

## Remediation

### Command Line

1. To prevent the user from overriding these settings, create the file `/etc/dconf/db/local.d/locks/00-screensaver` with the following content:

```
# Lock desktop screensaver settings
/org/gnome/desktop/session/idle-delay
/org/gnome/desktop/screensaver/lock-delay
/org/gnome/desktop/screensaver/lock-enabled
```

2. Update the system databases:

```bash
# dconf update
```

Note:
- A user profile must exist in order to apply locks. If a user profile does not exist review the remediation steps in the previous recommendation.
- Users must log out and back in again before the system-wide settings take effect.

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/desktop-lockscreen.html.en
2. https://help.gnome.org/admin/system-admin-guide/stable/dconf-lockdown.html.en
3. NIST SP 800-53 Rev. 5: CM-11

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.3 Configure Automatic Session Locking on Enterprise Assets | * | * | * |
| v7 | 16.11 Lock Workstation Sessions After Inactivity | * | * | * |

MITRE ATT&CK Mappings: T1456 | TA0027 | M1001
