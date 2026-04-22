---
name: cis-ubuntu2004-v300-1-7-7
description: "Ensure GDM disabling automatic mounting of removable media is not overridden"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, gnome, gdm, removable-media, dconf-lock]
cis_id: "1.7.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.7 Ensure GDM disabling automatic mounting of removable media is not overridden (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

By default GNOME automatically mounts removable media when inserted as a convenience to the user.

By using the lockdown mode in dconf, you can prevent users from changing specific settings. To lock down a dconf key or subpath, create a locks subdirectory in the keyfile directory. The files inside this directory contain a list of keys or subpaths to lock. Just as with the keyfiles, you may add any number of files to this directory.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Impact

The use of portable hard drives is very common for workstation users.

## Audit Procedure

### Command Line

Run the following command to verify `automount=false` and `automount-open=false` is correctly configured to ensure automatic mounting of removable media is not overridden:

```bash
# grep -Psi "automount" /etc/dconf/db/*/locks/*
```

```
/etc/dconf/db/local.d/locks/00-media-automount:automount=false
/etc/dconf/db/local.d/locks/00-media-automount:automount-open=false
```

## Expected Result

Lock entries for `automount` and `automount-open` should be present.

## Remediation

### Command Line

1. To prevent the user from overriding these settings, create the file `/etc/dconf/db/local.d/locks/00-media-automount` with the following content:

```
[org/gnome/desktop/media-handling]
automount=false
automount-open=false
```

2. Update the systems databases:

```bash
# dconf update
```

Note:
- A user profile must exist in order to apply locks. If a user profile does not exist review the remediation steps in the previous recommendation.
- Users must log out and back in again before the system-wide settings take effect.

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/dconf-lockdown.html.en
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5
3. https://manpages.ubuntu.com/manpages/trusty/man1/gsettings.1.html
4. https://access.redhat.com/solutions/20107

MITRE ATT&CK Mappings: T1091, T1091.000 | TA0001, TA0008 | M1042
