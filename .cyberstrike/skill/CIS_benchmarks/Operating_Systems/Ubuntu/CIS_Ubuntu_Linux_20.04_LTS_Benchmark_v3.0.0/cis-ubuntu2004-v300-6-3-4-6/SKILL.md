---
name: cis-ubuntu2004-v300-6-3-4-6
skill: cis-ubuntu2004-v300-6-3-4-6
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.6 Ensure audit configuration files owner is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
Audit configuration files control auditd and what events are audited.

## Rationale
Access to the audit configuration files could allow unauthorized personnel to prevent the auditing of critical events.

Misconfigured audit configuration files may prevent the auditing of critical events or impact the system's performance by overwhelming the audit log. Misconfiguration of the audit configuration files may also make it more difficult to establish and investigate events relating to an incident.

## Audit
Run the following command to verify that the audit configuration files are owned by the root user:

```bash
find /etc/audit/ -type f \( -name '*.conf' -o -name '*.rules' \) ! -user root
```

Nothing should be returned.

## Remediation
Run the following command to change ownership to `root` user:

```bash
find /etc/audit/ -type f \( -name '*.conf' -o -name '*.rules' \) ! -user root -exec chown root {} +
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
