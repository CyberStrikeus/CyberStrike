---
name: cis-ubuntu1804-v220-6-1-7
description: "Ensure permissions on /etc/gshadow are configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, file-permissions]
cis_id: "6.1.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.7 Ensure permissions on /etc/gshadow are configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/gshadow` file is used to store the information about groups that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

If attackers can gain read access to the `/etc/gshadow` file, they can easily run a password cracking program against the hashed password to break it. Other security information that is stored in the `/etc/gshadow` file (such as group administrators) could also be useful to subvert the group.

## Audit Procedure

### Command Line

Run the following command to verify `/etc/gshadow` is mode 640 or more restrictive, `Uid` is `0/root` and `Gid` is `0/root` or `{GID}/shadow`:

```bash
# stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/gshadow
```

## Expected Result

```
Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)
```

## Remediation

### Command Line

Run one of the following commands to set ownership of `/etc/gshadow` to `root` and group to either `root` or `shadow`:

```bash
# chown root:shadow /etc/gshadow
  -OR-
# chown root:root /etc/gshadow
```

Run the following command to remove excess permissions from `/etc/gshadow`:

```bash
# chmod u-x,g-wx,o-rwx /etc/gshadow
```

## Default Value

Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
