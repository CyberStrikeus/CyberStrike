---
name: cis-ubuntu1604-v200-1-4-4
description: "Ensure authentication required for single user mode"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, single-user-mode, authentication, root-password]
cis_id: "1.4.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.4.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Single user mode is used for recovery when the system detects an issue during boot or by manual selection from the bootloader.

## Rationale

Requiring authentication in single user mode prevents an unauthorized user from rebooting the system into single user to gain root privileges without credentials.

## Audit Procedure

### Command Line

Perform the following to determine if a password is set for the root user:

```bash
grep -Eq '^root:\$[0-9]' /etc/shadow || echo "root is locked"
```

No results should be returned.

## Expected Result

The command should return no output, indicating root has a password set. If "root is locked" is returned, root does not have a password set.

## Remediation

### Command Line

Run the following command and follow the prompts to set a password for the root user:

```bash
passwd root
```

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control                             |
| ---------------- | ----------------------------------- |
| v7               | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
