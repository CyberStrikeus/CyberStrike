---
name: cis-ubuntu1604-v200-5-1-9
description: "Ensure at is restricted to authorized users"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.1.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.1.9

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Configure `/etc/at.allow` to allow specific users to use this service. If `/etc/at.allow` does not exist, then `/etc/at.deny` is checked. Any user not specifically defined in this file is allowed to use at. By removing the file, only users in `/etc/at.allow` are allowed to use at.

Note: Other methods, such as `systemd timers`, exist for scheduling jobs. If another method is used, `at` should be removed, and the alternate method should be secured in accordance with local site policy.

## Rationale

On many systems, only the system administrator is authorized to schedule `at` jobs. Using the `at.allow` file to control who can run `at` jobs enforces this policy. It is easier to manage an allow list than a deny list. In a deny list, you could potentially add a user ID to the system and forget to add it to the deny files.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify that `/etc/at.deny` does not exist:

```bash
stat /etc/at.deny
```

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access`, does not grant write or execute to group, and does not grant permissions to `other` for `/etc/at.allow`:

```bash
stat /etc/at.allow
```

## Expected Result

The first command should return:

```
stat: cannot stat '/etc/at.deny': No such file or directory
```

The second command should return:

```
Access: (0640/-rw-r-----)  Uid: (    0/    root)  Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following commands to remove `/etc/at.deny`:

```bash
rm /etc/at.deny
```

Run the following command to create `/etc/at.allow`:

```bash
touch /etc/at.allow
```

Run the following commands to set permissions and ownership for `/etc/at.allow`:

```bash
chmod g-wx,o-rwx /etc/at.allow
chown root:root /etc/at.allow
```

## Default Value

By default, `/etc/at.deny` exists and `/etc/at.allow` does not exist.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
