---
name: cis-ubuntu1804-v220-5-2-3-11
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure successful file system mounts are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.11 Ensure successful file system mounts are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor the use of the `mount` system call. The `mount` (and `umount`) system call controls the mounting and unmounting of file systems. The parameters below configure the system to create an audit record when the `mount` system call is used by a non-privileged user.

## Rationale

It is highly unusual for a non privileged user to mount file systems to the system. While tracking mount commands gives the system administrator evidence that external media may have been mounted (based on a review of the source of the mount and confirming it's an external media type), it does not conclusively indicate that data was exported to the media. System administrators who wish to determine if data were exported, would also have to track successful `open`, `creat` and `truncate` system calls requiring write access to a file under the mount point of the external media file system. This could give a fair indication that a write occurred. The only way to truly prove it, would be to track successful writes to the external media. Tracking write system calls could quickly fill up the audit log and is not recommended. Recommendations on configuration options to track data export to media is beyond the scope of this document.

## Audit

Run the following command to verify `auditd` is configured in accordance with site policy.

### On disk configuration

#### 64 Bit systems

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-a *always,exit/ \
&&(/ -F *arch=b(32|64)/) \
&&/ -S/ \
&&/mount/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify output includes:

```
-a always,exit -F arch=b64 -S mount -F auid>=1000 -F auid!=unset -k mounts
-a always,exit -F arch=b32 -S mount -F auid>=1000 -F auid!=unset -k mounts
```

### Running configuration

#### 64 Bit systems

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && auditctl -l | awk "/^ *-a *always,exit/ \
&&(/ -F *arch=b(32|64)/) \
&&/ -S/ \
&&/mount/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify output includes:

```
-a always,exit -F arch=b64 -S mount -F auid>=1000 -F auid!=-1 -F key=mounts
-a always,exit -F arch=b32 -S mount -F auid>=1000 -F auid!=-1 -F key=mounts
```

#### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules` extension, with the relevant rules to monitor successful file system mounts.

### 64 Bit systems

Example:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b32 -S mount -F auid>=%s -F auid!=unset -k mounts
-a always,exit -F arch=b64 -S mount -F auid>=%s -F auid!=unset -k mounts
" "${UID_MIN}" "${UID_MIN}" >> /etc/audit/rules.d/50-mounts.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References

- NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

| Version | Control | IG 1 | IG 2 | IG 3 |
|---------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | ● | ● |
| v7 | 5.1 Establish Secure Configurations | ● | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|----------------------------|---------|-------------|
| T1562, T1562.006 | TA0005 | M1047 |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
