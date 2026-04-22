---
name: cis-ubuntu1804-v220-5-2-3-17
description: Ensure successful and unsuccessful attempts to use the chacl command are recorded
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure successful and unsuccessful attempts to use the chacl command are recorded (5.2.3.17)

## Metadata
- **ID**: cis-ubuntu1804-v220-5-2-3-17
- **Title**: Ensure successful and unsuccessful attempts to use the chacl command are recorded
- **CIS Control**: 5.2.3.17
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description
The operating system must generate audit records for successful/unsuccessful uses of the `chacl` command.

`chacl` is an IRIX-compatibility command, and is maintained for those users who are familiar with its use from either XFS or IRIX.

## Rationale
`chacl` changes the ACL(s) for a file or directory. Without generating audit records that are specific to the security and mission needs of the organization, it would be difficult to establish, correlate, and investigate the events relating to an incident or identify those responsible for one.

Audit records can be generated from various components within the information system (e.g., module or policy filter).

## Impact
None

## Audit

### On Disk Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-a *always,exit/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -F *auid>=${UID_MIN}/ \
&&/ -F *perm=x/ \
&&/ -F *path=\/usr\/bin\/chacl/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

**Expected Output**:
```
-a always,exit -F path=/usr/bin/chacl -F perm=x -F auid>=1000 -F auid!=unset -k perm_chng
```

### Running Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && auditctl -l | awk "/^ *-a *always,exit/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -F *auid>=${UID_MIN}/ \
&&/ -F *perm=x/ \
&&/ -F *path=\/usr\/bin\/chacl/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/"
```

**Expected Output**:
```
-a always,exit -S all -F path=/usr/bin/chacl -F perm=x -F auid>=1000 -F auid!=-1 -F key=perm_chng
```

### 32-bit Systems
Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create Audit Rules
Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor successful and unsuccessful attempts to use the `chacl` command.

Example:
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F path=/usr/bin/chacl -F perm=x -F auid>=${UID_MIN} -F auid!=unset -k perm_chng
" >> /etc/audit/rules.d/50-perm_chng.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
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
- NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5

## CIS Controls
- **v8**: 8.2 Collect Audit Logs
- **v7**: 6.2 Activate audit logging

## MITRE ATT&CK Mappings
- **Techniques**: T1562, T1562.006
- **Tactics**: TA0005
- **Mitigations**: M1022

## Additional Information

### Potential Reboot Required
If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### System Call Structure
For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
