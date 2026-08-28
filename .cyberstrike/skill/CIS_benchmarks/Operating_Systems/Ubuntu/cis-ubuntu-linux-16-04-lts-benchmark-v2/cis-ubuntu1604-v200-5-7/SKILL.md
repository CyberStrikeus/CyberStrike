---
name: cis-ubuntu1604-v200-5-7
description: "Ensure access to the su command is restricted"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to the su command is restricted

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `su` command allows a user to run a command or shell as another user. The program has been superseded by `sudo`, which allows for more granular control over privileged access. Normally, the `su` command can be executed by any user. By adding, or uncommenting, the `pam_wheel.so` statement in `/etc/pam.d/su`, the `su` command will only allow users in a specific group to execute `su`. This group should be empty to reinforce the use of `sudo` for privileged access.

## Rationale

Restricting the use of `su`, and using `sudo` in its place, provides system administrators better control of the escalation of user privileges to execute privileged commands. The `sudo` utility also provides a better logging and audit mechanism, as it can log each command executed via `sudo`, whereas `su` can only record that a user executed the `su` program.

## Audit Procedure

### Command Line

Run the following command and verify the output matches the line:

```bash
grep pam_wheel.so /etc/pam.d/su
```

**Expected output:**

```
auth required pam_wheel.so use_uid group=<group_name>
```

Run the following command and verify that the group specified in `<group_name>` contains no users:

```bash
grep <group_name> /etc/group
```

**Expected output:**

```
<group_name>:x:<GID>:
```

There should be no users listed after the Group ID field.

## Remediation

### Command Line

Create an empty group that will be specified for use of the `su` command. The group should be named according to site policy.

_Example:_

```bash
groupadd sugroup
```

Add the following line to the `/etc/pam.d/su` file, specifying the empty group:

_Example:_

```
auth required pam_wheel.so use_uid group=sugroup
```

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
