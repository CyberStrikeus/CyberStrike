---
name: cis-ubuntu2004-v300-7-1-6
description: "Ensure access to /etc/shadow- is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, file-permissions]
cis_id: "7.1.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.6 Ensure access to /etc/shadow- is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/shadow-` file is used to store backup information about user accounts that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

It is critical to ensure that the `/etc/shadow-` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Impact

None

## Audit Procedure

### Command Line

Run the following command to verify `/etc/shadow-` is mode 640 or more restrictive, `Uid` is `0/root` and `Gid` is `0/root` or `{GID}/shadow`:

```bash
# stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/shadow-
```

Example:

```
Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)
```

## Expected Result

Mode 640 or more restrictive, Uid 0/root, Gid 0/root or {GID}/shadow.

## Remediation

### Command Line

Run one of the following commands to set ownership of `/etc/shadow-` to `root` and group to either `root` or `shadow`:

```bash
# chown root:shadow /etc/shadow-
  -OR-
# chown root:root /etc/shadow-
```

Run the following command to remove excess permissions from `/etc/shadow-`:

```bash
# chmod u-x,g-wx,o-rwx /etc/shadow-
```

## Default Value

Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1003, T1003.008, T1222, T1222.002 | TA0005  | M1022       |
