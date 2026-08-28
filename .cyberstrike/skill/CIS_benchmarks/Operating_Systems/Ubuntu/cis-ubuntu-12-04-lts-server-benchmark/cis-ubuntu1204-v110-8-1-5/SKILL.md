---
name: cis-ubuntu1204-v110-8-1-5
description: "Record Events That Modify User/Group Information"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, user, group, identity]
cis_id: "8.1.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.5 Record Events That Modify User/Group Information (Scored)

## Profile Applicability

- Level 2

## Description

Record events affecting the `group`, `passwd` (user IDs), `shadow` and `gshadow` (passwords) or `/etc/security/opasswd` (old passwords, based on remember parameter in the PAM configuration) files. The parameters in this section will watch the files to see if they have been opened for write or have had attribute changes (e.g. permissions) and tag them with the identifier "identity" in the audit log file.

## Rationale

Unexpected changes to these files could be an indication that the system has been compromised and that an unauthorized user is attempting to hide their activities or compromise additional accounts.

## Audit Procedure

### Using Command Line

Perform the following to determine if events that modify user/group information are recorded.

```bash
grep identity /etc/audit/audit.rules
```

## Expected Result

```
-w /etc/group -p wa -k identity
-w /etc/passwd -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /etc/group -p wa -k identity
-w /etc/passwd -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
# Execute the following command to restart auditd
# pkill -P 1-HUP auditd
```

## Default Value

By default, user/group modification events are not audited.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
