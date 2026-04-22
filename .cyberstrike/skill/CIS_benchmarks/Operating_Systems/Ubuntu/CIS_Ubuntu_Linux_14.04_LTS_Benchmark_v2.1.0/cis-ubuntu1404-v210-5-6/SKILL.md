---
name: "CIS Ubuntu 14.04 LTS - 5.6 Ensure access to the su command is restricted"
description: "Verify access to the su command is restricted to the wheel group via PAM configuration"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - pam
cis_id: "5.6"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.6 Ensure access to the su command is restricted (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `su` command allows a user to run a command or shell as another user. The program has been superseded by `sudo`, which allows for more granular control over privileged access. Normally, the `su` command can be executed by any user. By uncommenting the `pam_wheel.so` statement in `/etc/pam.d/su`, the `su` command will only allow users in the wheel group to execute `su`.

## Rationale

Restricting the use of `su`, and using `sudo` in its place, provides system administrators better control of the escalation of user privileges to execute privileged commands. The sudo utility also provides a better logging and audit mechanism, as it can log each command executed via `sudo`, whereas `su` can only record that a user executed the `su` program.

## Audit Procedure

Run the following command and verify output includes matching line:

```bash
grep pam_wheel.so /etc/pam.d/su
```

Run the following command and verify users in `wheel` group match site policy:

```bash
grep wheel /etc/group
```

## Expected Result

```
auth required pam_wheel.so
wheel:x:10:root,<user list>
```

## Remediation

Add the following line to the `/etc/pam.d/su` file:

```
auth required pam_wheel.so
```

Create a comma separated list of users in the wheel statement in the `/etc/group` file:

```
wheel:x:10:root,<user list>
```

## Default Value

su is available to all users by default.

## References

- CIS Controls: 5.1 - Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
