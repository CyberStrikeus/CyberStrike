---
name: cis-ubuntu2004-v300-1-7-4
description: "Ensure GDM screen locks when the user is idle"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, screen-lock, idle]
cis_id: "1.7.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.4 Ensure GDM screen locks when the user is idle (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

GNOME Desktop Manager can make the screen lock automatically whenever the user is idle for some amount of time.

## Rationale

Setting a lock-out value reduces the window of opportunity for unauthorized user access to another user's session that has been left unattended.

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

Run the following commands to verify that the screen locks when the user is idle:

```bash
# gsettings get org.gnome.desktop.screensaver lock-delay
uint32 5
# gsettings get org.gnome.desktop.session idle-delay
uint32 900
# gsettings get org.gnome.desktop.screensaver lock-enabled
true
```

Notes:
- `lock-delay=uint32 {n}` - should be `5` seconds or less and follow local site policy
- `idle-delay=uint32 {n}` - Should be `900` seconds (15 minutes) or less, not `0` (disabled) and follow local site policy
- `lock-enabled` - must be set to `true` for screen locks to lock when the user is idle

## Expected Result

- `lock-delay` should be 5 seconds or less
- `idle-delay` should be 900 seconds or less (not 0)
- `lock-enabled` should be `true`

## Remediation

### Command Line

- IF - A user profile is already created run the following commands to enable screen locks when the user is idle:

```bash
# gsettings set org.gnome.desktop.screensaver lock-delay 5
# gsettings set org.gnome.desktop.session idle-delay 900
# gsettings set org.gnome.desktop.screensaver lock-enabled true
```

Note:
- `gsettings` commands in this section MUST be done from a command window on a graphical desktop or an error will be returned.
- The system must be restarted after all `gsettings` configurations have been set in order for CIS-CAT Assessor to appropriately assess.

- OR/IF - A user profile does not exist:

1. Create or edit the user profile in the `/etc/dconf/profile/` and verify it includes the following:

```
user-db:user
system-db:{NAME_OF_DCONF_DATABASE}
```

Note: `local` is the name of a dconf database used in the examples.

2. Create the directory `/etc/dconf/db/local.d/` if it doesn't already exist.
3. Create the key file `/etc/dconf/db/local.d/00-screensaver` to provide information for the `local` database:

Example key file:
```
# Specify the dconf path
[org/gnome/desktop/session]

# Number of seconds of inactivity before the screen goes blank
# Set to 0 seconds if you want to deactivate the screensaver.
idle-delay=uint32 180

# Specify the dconf path
[org/gnome/desktop/screensaver]

# Number of seconds after the screen is blank before locking the screen
lock-delay=uint32 0

# Ensure screen locks after inactivity
lock-enabled=true
```

Note: You must include the uint32 along with the integer key values as shown.

4. Run the following command to update the system databases:

```bash
# dconf update
```

5. Users must log out and back in again before the system-wide settings take effect.

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/desktop-lockscreen.html.en

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.3 Configure Automatic Session Locking on Enterprise Assets | * | * | * |
| v7 | 16.11 Lock Workstation Sessions After Inactivity | * | * | * |

MITRE ATT&CK Mappings: T1461 | TA0027 | M1012
