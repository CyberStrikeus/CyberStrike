---
name: cis-ubuntu2004-v300-5-2-4
description: "Ensure users must provide password for privilege escalation"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, sudo]
cis_id: "5.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure users must provide password for privilege escalation (Automated)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The operating system must be configured so that users must provide a password for privilege escalation.

## Rationale

Without (re-)authentication, users may access resources or perform tasks for which they do not have authorization.

When operating systems provide the capability to escalate a functional capability, it is critical the user (re-)authenticate.

## Impact

This will prevent automated processes from being able to elevate privileges.

## Audit Procedure

### Command Line

Note: If passwords are not being used for authentication, this is not applicable.
Verify the operating system requires users to supply a password for privilege escalation.
Check the configuration of the `/etc/sudoers` and `/etc/sudoers.d/*` files with the following command:

```bash
# grep -r "^[^#].*NOPASSWD" /etc/sudoers*
```

If any line is found refer to the remediation procedure below.

## Expected Result

No output should be returned (no NOPASSWD entries found).

## Remediation

### Command Line

Based on the outcome of the audit procedure, use `visudo -f <PATH TO FILE>` to edit the relevant sudoers file.
Remove any line with occurrences of `NOPASSWD` tags in the file.

## References

1. NIST SP 800-53 Rev. 5: AC-6

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts
Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

MITRE ATT&CK Mappings: T1548 | TA0004 | M1026
