---
name: cis-ubuntu2004-v300-6-3-4-9
skill: cis-ubuntu2004-v300-6-3-4-9
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.9 Ensure audit tools owner is configured (Automated)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Audit tools include, but are not limited to, vendor-provided and open source audit tools needed to successfully view and manipulate audit information system activity and records. Audit tools include custom queries and report generators.

## Rationale

Protecting audit information includes identifying and protecting the tools used to view and manipulate log data. Protecting audit tools is necessary to prevent unauthorized operation on audit information.

## Audit

Run the following command to verify the audit tools are owned by the `root` user:

```bash
stat -Lc "%n %U" /sbin/auditctl /sbin/aureport /sbin/ausearch /sbin/autrace /sbin/auditd /sbin/augenrules | awk '$2 != "root" {print}'
```

Nothing should be returned.

## Remediation

Run the following command to change the owner of the audit tools to the `root` user:

```bash
chown root /sbin/auditctl /sbin/aureport /sbin/ausearch /sbin/autrace /sbin/auditd /sbin/augenrules
```

## References

1. NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

- v8: 3.3 Configure Data Access Control Lists
- v7: 14.6 Protect Information through Access Control Lists

## MITRE ATT&CK Mappings

- **Techniques**: T1070, T1070.002, T1083, T1083.000
- **Tactics**: TA0007
- **Mitigations**: M1022
