---
name: cis-ubuntu1804-v220-4-3-5
description: "Ensure re-authentication for privilege escalation is not disabled globally"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.5

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The operating system must be configured so that the `!authenticate` option is not used in `/etc/sudoers` or in any included sudoers file.

## Rationale

Without re-authentication, users may access resources or perform tasks for which they do not have authorization. When operating systems provide the capability to escalate a functional capability, it is critical the user re-authenticate.

## Audit Procedure

### Command Line

Run the following command to verify that `!authenticate` is not configured:

```bash
grep -r "!authenticate" /etc/sudoers /etc/sudoers.d/
```

### Expected Result

Nothing should be returned. If output is returned, it means re-authentication has been disabled.

## Remediation

### Command Line

Remove any occurrences of `!authenticate` found in `/etc/sudoers` or files in `/etc/sudoers.d/`.

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

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
