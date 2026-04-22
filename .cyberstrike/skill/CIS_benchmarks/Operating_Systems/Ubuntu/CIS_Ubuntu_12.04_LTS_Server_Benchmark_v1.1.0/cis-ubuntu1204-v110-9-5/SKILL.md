---
name: cis-ubuntu1204-v110-9-5
description: "Restrict Access to the su Command"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, su, privilege-escalation, pam]
cis_id: "9.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.5 Restrict Access to the su Command (Scored)

## Profile Applicability

- Level 1

## Description

The `su` command allows a user to run a command or shell as another user. The program has been superseded by `sudo`, which allows for more granular control over privileged access. Normally, the `su` command can be executed by any user. By uncommenting the `pam_wheel.so` statement in `/etc/pam.d/su`, the `su` command will only allow users in the wheel group to execute `su`.

## Rationale

Restricting the use of `su`, and using `sudo` in its place, provides system administrators better control of the escalation of user privileges to execute privileged commands. The `sudo` utility also provides a better logging and audit mechanism, as it can log each command executed via `sudo`, whereas `su` can only record that a user executed the `su` program.

## Audit Procedure

### Using Command Line

```bash
grep pam_wheel.so /etc/pam.d/su
grep wheel /etc/group
```

## Expected Result

```
auth required pam_wheel.so use_uid
wheel:x:10:root, <user list>
```

## Remediation

### Using Command Line

Add the following line to the `/etc/pam.d/su` file:

```bash
auth required pam_wheel.so use_uid
```

Once this is done, create a comma separated list of users in the wheel statement in the `/etc/group` file.

## Default Value

The pam_wheel.so line is commented out by default in /etc/pam.d/su.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
