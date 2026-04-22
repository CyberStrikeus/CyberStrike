---
name: cis-ubuntu1804-v220-5-2-3-13
description: Ensure file deletion events by users are collected
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure file deletion events by users are collected (5.2.3.13)

## Metadata
- **ID**: cis-ubuntu1804-v220-5-2-3-13
- **Title**: Ensure file deletion events by users are collected
- **CIS Control**: 5.2.3.13
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description
Monitor the use of system calls associated with the deletion or renaming of files and file attributes. This configuration statement sets up monitoring for:

- `unlink` - remove a file
- `unlinkat` - remove a file attribute
- `rename` - rename a file
- `renameat` - rename a file attribute system calls and tags them with the identifier "delete"

## Rationale
Monitoring these calls from non-privileged users could provide a system administrator with evidence that inappropriate removal of files and file attributes associated with protected files is occurring. While this audit option will look at all events, system administrators will want to look for specific privileged files that are being deleted or altered.

## Impact
None

## Audit

### On Disk Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-a *always,exit/ \
&&/ -F *arch=b[2346][24]/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&/ -F *auid>=${UID_MIN}/ \
&&(/unlink/||/rename/||/unlinkat/||/renameat/) \
&&/ -F *key=delete/ \
&&/ -k *delete/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

**Expected Output**:
```
-a always,exit -F arch=b64 -S unlink,unlinkat,rename,renameat -F auid>=1000 -F auid!=unset -k delete
-a always,exit -F arch=b32 -S unlink,unlinkat,rename,renameat -F auid>=1000 -F auid!=unset -k delete
```

### Running Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && auditctl -l | awk "/^ *-a *always,exit/ \
&&/ -F *arch=b[2346][24]/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&/ -F *auid>=${UID_MIN}/ \
&&(/unlink/||/rename/||/unlinkat/||/renameat/) \
&&/ -F *key=delete/ \
&&/ -k *delete/"
```

**Expected Output**:
```
-a always,exit -F arch=b64 -S rename,unlink,unlinkat,renameat -F auid>=1000 -F auid!=-1 -F key=delete
-a always,exit -F arch=b32 -S unlink,rename,unlinkat,renameat -F auid>=1000 -F auid!=-1 -F key=delete
```

### 32-bit Systems
Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create Audit Rules
Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor file deletion events by users.

Example:
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b64 -S rename,unlink,unlinkat,renameat -F auid>=${UID_MIN} -F auid!=unset -k delete
-a always,exit -F arch=b32 -S rename,unlink,unlinkat,renameat -F auid>=${UID_MIN} -F auid!=unset -k delete
" >> /etc/audit/rules.d/50-delete.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

### Load Audit Rules
Merge and load the rules into active configuration:
```bash
augenrules --load
```

Check if reboot is required:
```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

### 32-bit Systems
Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References
- NIST SP 800-53 Rev. 5: AU-12, SC-7

## CIS Controls
- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 6.2 Activate audit logging

## MITRE ATT&CK Mappings
- **Techniques**: T1562, T1562.006
- **Tactics**: TA0005
- **Mitigations**: M1047

## Additional Information

### Potential Reboot Required
If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### System Call Structure
For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
