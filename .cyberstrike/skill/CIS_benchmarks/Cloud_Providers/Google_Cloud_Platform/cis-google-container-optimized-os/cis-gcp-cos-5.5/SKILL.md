---
name: cis-gcp-cos-5.5
description: "Ensure access to the su command is restricted"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, su, access-control]
cis_id: "5.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5 Ensure access to the su command is restricted (Automated)

## Description

The `su` command allows a user to run a command or shell as another user. The program has been superseded by `sudo`, which allows for more granular control over privileged access. Normally, the `su` command can be executed by any user. By uncommenting the `pam_wheel.so` statement in `/etc/pam.d/su`, the `su` command will only allow users in the wheel group to execute `su`.

## Rationale

Restricting the use of `su`, and using `sudo` in its place, provides system administrators better control of the escalation of user privileges to execute privileged commands. The sudo utility also provides a better logging and audit mechanism, as it can log each command executed via `sudo`, whereas `su` can only record that a user executed the `su` program.

## Audit Procedure

Run the following command and verify output includes matching line:

```bash
# grep pam_wheel.so /etc/pam.d/su
auth required pam_wheel.so use_uid
```

Run the following command and verify users in `wheel` group match site policy:

```bash
# grep wheel /etc/group
wheel:!:10:root,<user list>
```

## Expected Result

The `/etc/pam.d/su` file should contain `auth required pam_wheel.so use_uid` and the wheel group in `/etc/group` should only contain authorized users.

## Remediation

Add the following line to the `/etc/pam.d/su` file:

```
auth required pam_wheel.so use_uid
```

Create a comma separated list of users in the wheel statement in the `/etc/group` file:

```
wheel:!:10:root,<user list>
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## Profile

- Level 1 - Server
