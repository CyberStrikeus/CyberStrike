---
name: cis-ubuntu1804-v220-4-3-4
description: "Ensure users must provide password for privilege escalation"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.4

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The operating system must be configured so that users must provide a password for privilege escalation.

## Rationale

Without re-authentication, users may access resources or perform tasks for which they do not have authorization. When operating systems provide the capability to escalate a functional capability, it is critical the user re-authenticate.

## Audit Procedure

### Command Line

Run the following commands to verify that no lines include `NOPASSWD`:

```bash
grep -r "NOPASSWD" /etc/sudoers /etc/sudoers.d/
```

### Expected Result

Nothing should be returned. If output is returned, it means a user can execute sudo commands without a password.

## Remediation

### Command Line

Remove any line from `/etc/sudoers` or files in `/etc/sudoers.d/` that include `NOPASSWD`.

Use `visudo` to edit the files:

```bash
visudo
visudo -f /etc/sudoers.d/<filename>
```

## References

1. NIST SP 800-53 Rev. 5: IA-11

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts.

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Assessment Status

Automated
