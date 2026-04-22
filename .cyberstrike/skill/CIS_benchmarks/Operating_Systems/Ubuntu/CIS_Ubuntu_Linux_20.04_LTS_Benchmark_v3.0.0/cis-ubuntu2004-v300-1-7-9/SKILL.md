---
name: cis-ubuntu2004-v300-1-7-9
description: "Ensure GDM autorun-never is not overridden"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, autorun, dconf-lock]
cis_id: "1.7.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.9 Ensure GDM autorun-never is not overridden (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The autorun-never setting allows the GNOME Desktop Display Manager to disable autorun through GDM.

By using the lockdown mode in dconf, you can prevent users from changing specific settings.

To lock down a dconf key or subpath, create a locks subdirectory in the keyfile directory. The files inside this directory contain a list of keys or subpaths to lock. Just as with the keyfiles, you may add any number of files to this directory.

## Rationale

Malware on removable media may taking advantage of Autorun features when the media is inserted into a system and execute.

## Audit Procedure

### Command Line

Run the following command to verify that `autorun-never=true` cannot be overridden:

```bash
# grep -Psi "autorun-never" /etc/dconf/db/*/locks/*
```

```
/etc/dconf/db/local.d/locks/00-media-autorun:autorun-never=true
```

## Expected Result

Lock entry for `autorun-never` should be present.

## Remediation

### Command Line

1. To prevent the user from overriding these settings, create the file `/etc/dconf/db/local.d/locks/00-media-autorun` with the following content:

```
[org/gnome/desktop/media-handling]
autorun-never=true
```

2. Update the systems databases:

```bash
# dconf update
```

Note:

- A user profile must exist in order to apply locks. If a user profile does not exist review the remediation steps in the previous recommendation.
- Users must log out and back in again before the system-wide settings take effect.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.3 Disable Autorun and Autoplay for Removable Media | \*   | \*   | \*   |
| v7               | 8.5 Configure Devices Not To Auto-run Content         | \*   | \*   | \*   |

MITRE ATT&CK Mappings: T1091, T1091.000 | TA0001, TA0008 | M1028
