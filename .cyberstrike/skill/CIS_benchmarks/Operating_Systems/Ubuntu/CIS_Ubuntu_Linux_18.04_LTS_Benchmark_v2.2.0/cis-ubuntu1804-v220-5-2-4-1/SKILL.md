---
name: cis-ubuntu1804-v220-5-2-4-1
description: 
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.4.1 Ensure audit log files are mode 0640 or less permissive

## Description

Audit log files contain information about the system and system activity.

## Rationale

Access to audit records can reveal system and configuration data to attackers, potentially compromising its confidentiality.

## Audit

Run the following command to verify audit log files have mode 0640 or less permissive:

```bash
[ -f /etc/audit/auditd.conf ] && find "$(dirname $(awk -F "=" '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs))" -type f -perm /0137 -exec stat -Lc "%n %a" {} +
```

**Expected result:** Nothing should be returned

## Remediation

Run the following command to remove more permissive mode than 0640 from audit log files:

```bash
[ -f /etc/audit/auditd.conf ] && find "$(dirname $(awk -F"=" '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs))" -type f -perm /0137 -exec chmod u-x,g-wx,o-rwx {} +
```

## References

1. NIST SP 800-53 Rev. 5: AU-3

## Metadata

- **Profile Applicability:** Level 2 - Server, Level 2 - Workstation
- **Category:** cis-logging
- **Tags:** cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Version:** 2.2.0
- **Severity Boost:** {}
- **Automated:** Yes
- **CIS Controls:**
  - v8: 3.3 Configure Data Access Control Lists
  - v7: 14.6 Protect Information through Access Control Lists
- **MITRE ATT&CK:**
  - Tactics: TA0007 (Discovery)
  - Techniques: T1070, T1070.002, T1083, T1083.000
  - Mitigations: M1047 (Audit)
