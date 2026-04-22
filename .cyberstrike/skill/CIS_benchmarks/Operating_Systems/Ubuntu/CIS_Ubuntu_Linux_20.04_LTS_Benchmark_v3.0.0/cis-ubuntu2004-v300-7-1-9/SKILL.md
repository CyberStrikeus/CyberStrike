---
name: cis-ubuntu2004-v300-7-1-9
description: "Ensure access to /etc/shells is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, file-permissions]
cis_id: "7.1.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.9 Ensure access to /etc/shells is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`/etc/shells` is a text file which contains the full pathnames of valid login shells. This file is consulted by `chsh` and available to be queried by other programs.

## Rationale

It is critical to ensure that the `/etc/shells` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Impact

None

## Audit Procedure

### Command Line

Run the following command to verify `/etc/shells` is mode 644 or more restrictive, `Uid` is `0/root` and `Gid` is `0/root`:

```bash
# stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/shells
```

## Expected Result

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

### Command Line

Run the following commands to remove excess permissions, set owner, and set group on `/etc/shells`:

```bash
# chmod u-x,go-wx /etc/shells
# chown root:root /etc/shells
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1003, T1003.008, T1222, T1222.002 | TA0005 | M1022 |
