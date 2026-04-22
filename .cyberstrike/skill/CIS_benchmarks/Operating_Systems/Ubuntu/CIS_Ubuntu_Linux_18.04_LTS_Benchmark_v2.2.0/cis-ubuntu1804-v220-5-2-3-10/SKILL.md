---
name: cis-ubuntu1804-v220-5-2-3-10
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure unsuccessful unauthorized file access attempts are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.10 Ensure unsuccessful unauthorized file access attempts are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor for unsuccessful attempts to access files. The parameters below are associated with system calls that control creation (`creat`), opening (`open`, `openat`) and truncation (`truncate`, `ftruncate`) of files. An audit log record will only be written for non-privileged users and for a non-Daemon event. All audit records will be tagged with the identifier "access."

## Rationale

Failed attempts to open, create or truncate files could be an indication that an individual or process is trying to gain unauthorized access to the system.

## Audit

Run the following commands to verify auditd is configured in accordance with site policy. For on disk configuration, the `-S` options may be on one line or multiple lines. For running configuration, the system calls will be on one line.

### On disk configuration

#### 64 Bit systems

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&(/creat/ \
 ||/open/ \
 ||/truncate/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify output includes:

```
-a always,exit -F arch=b64 -S creat,open,openat,truncate,ftruncate -F exit=-EACCES -F auid>=1000 -F auid!=unset -k access
-a always,exit -F arch=b64 -S creat,open,openat,truncate,ftruncate -F exit=-EPERM -F auid>=1000 -F auid!=unset -k access
-a always,exit -F arch=b32 -S creat,open,openat,truncate,ftruncate -F exit=-EACCES -F auid>=1000 -F auid!=unset -k access
-a always,exit -F arch=b32 -S creat,open,openat,truncate,ftruncate -F exit=-EPERM -F auid>=1000 -F auid!=unset -k access
```

### Running configuration

#### 64 Bit systems

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && auditctl -l | awk "/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&(/creat/ \
 ||/open/ \
 ||/truncate/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

Verify output includes:

```
-a always,exit -F arch=b64 -S open,truncate,ftruncate,creat,openat -F exit=-EACCES -F auid>=1000 -F auid!=-1 -F key=access
-a always,exit -F arch=b64 -S open,truncate,ftruncate,creat,openat -F exit=-EPERM -F auid>=1000 -F auid!=-1 -F key=access
-a always,exit -F arch=b32 -S open,truncate,ftruncate,creat,openat -F exit=-EACCES -F auid>=1000 -F auid!=-1 -F key=access
-a always,exit -F arch=b32 -S open,truncate,ftruncate,creat,openat -F exit=-EPERM -F auid>=1000 -F auid!=-1 -F key=access
```

#### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules` extension, with rules to monitor unauthorized access attempts.

### 64 Bit systems

Example:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b64 -S creat,open,openat,truncate,ftruncate -F exit=-EACCES -F auid>=%s -F auid!=unset -k access
-a always,exit -F arch=b64 -S creat,open,openat,truncate,ftruncate -F exit=-EPERM -F auid>=%s -F auid!=unset -k access
-a always,exit -F arch=b32 -S creat,open,openat,truncate,ftruncate -F exit=-EACCES -F auid>=%s -F auid!=unset -k access
-a always,exit -F arch=b32 -S creat,open,openat,truncate,ftruncate -F exit=-EPERM -F auid>=%s -F auid!=unset -k access
" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" >> /etc/audit/rules.d/50-access.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
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

| Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8      | 8.5 Collect Detailed Audit Logs                                     |      | ●    | ●    |
| v7      | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |      |      | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1562, T1562.006            | TA0007  | M1047       |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
