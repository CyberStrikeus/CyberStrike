---
name: cis-ubuntu1804-v220-4-3-7
description: "Ensure access to the su command is restricted"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.7

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `su` command allows a user to run a command or shell as another user. The program has been superseded by `sudo`, which allows for more granular control over privileged access. Normally, the `su` command can be executed by any user. By uncommenting the `pam_wheel.so` statement in `/etc/pam.d/su`, the `su` command will only allow users in a specific group to execute `su`. This group should be empty to reinforce the use of `sudo` for privileged access.

## Rationale

Restricting the use of `su`, and using `sudo` in its place, provides system administrators better control of the escalation of user privileges to execute privileged commands. The sudo utility also provides a better logging and audit mechanism, as it can log each command executed via `sudo`, whereas `su` can only record that a user executed the `su` program.

## Audit Procedure

### Command Line

Run the following command to verify the pam_wheel.so module is enabled and a group is specified:

```bash
grep -Pi '^\h*auth\h+(?:required|requisite)\h+pam_wheel\.so\h+(?:[^#\n\r]+\h+)?(use_uid\b|group=\H+\b)' /etc/pam.d/su
```

### Expected Result

```
auth required pam_wheel.so use_uid group=<group_name>
```

Verify the group specified has no members:

```bash
grep <group_name> /etc/group
```

## Remediation

### Command Line

Create an empty group that will be specified for use of the `su` command:

```bash
groupadd sugroup
```

Add the following line to `/etc/pam.d/su`:

```bash
auth required pam_wheel.so use_uid group=sugroup
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, AC-5, AC-6, AC-6(2), AC-6(10), MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know.

v7 - 14.6 Protect Information through Access Control Lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
