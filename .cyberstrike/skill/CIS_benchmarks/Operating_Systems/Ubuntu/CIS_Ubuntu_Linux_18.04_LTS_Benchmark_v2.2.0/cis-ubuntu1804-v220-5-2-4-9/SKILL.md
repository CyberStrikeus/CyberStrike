---
name: cis-ubuntu1804-v220-5-2-4-9
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

# 5.2.4.9 Ensure audit tools are owned by root

## Description

Audit tools include, but are not limited to, vendor-provided and open source audit tools needed to successfully view and manipulate audit information system activity and records. Audit tools include custom queries and report generators.

## Rationale

Protecting audit information includes identifying and protecting the tools used to view and manipulate log data. Protecting audit tools is necessary to prevent unauthorized operation on audit information.

## Audit

Run the following command to verify the audit tools have mode 755 or more restrictive, are owned by the root user and group root:

```bash
stat -Lc "%n %U" /sbin/auditctl /sbin/aureport /sbin/ausearch /sbin/autrace /sbin/auditd /sbin/augenrules | grep -Pv -- '^\h*\H+\h+root\h*$'
```

**Expected result:** Nothing should be returned

## Remediation

Run the following command to change the owner of the audit tools to the root user:

```bash
chown root /sbin/auditctl /sbin/aureport /sbin/ausearch /sbin/autrace /sbin/auditd /sbin/augenrules
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
