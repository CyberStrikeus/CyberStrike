---
name: cis-ubuntu2004-v300-7-1-10
description: "Ensure access to /etc/security/opasswd is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, file-permissions]
cis_id: "7.1.10"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.10 Ensure access to /etc/security/opasswd is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`/etc/security/opasswd` and its backup `/etc/security/opasswd.old` hold user's previous passwords if `pam_unix` or `pam_pwhistory` is in use on the system.

## Rationale

It is critical to ensure that `/etc/security/opasswd` is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Impact

None

## Audit Procedure

### Command Line

Run the following commands to verify `/etc/security/opasswd` and `/etc/security/opasswd.old` are mode 600 or more restrictive, `Uid` is `0/root` and `Gid` is `0/root` if they exist:

```bash
# [ -e "/etc/security/opasswd" ] && stat -Lc '%n Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/security/opasswd
```

```
/etc/security/opasswd Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)
  -OR-
Nothing is returned
```

```bash
# [ -e "/etc/security/opasswd.old" ] && stat -Lc '%n Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/security/opasswd.old
```

```
/etc/security/opasswd.old Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)
  -OR-
Nothing is returned
```

## Expected Result

Mode 600 or more restrictive, Uid 0/root, Gid 0/root for both files (if they exist).

## Remediation

### Command Line

Run the following commands to remove excess permissions, set owner, and set group on `/etc/security/opasswd` and `/etc/security/opasswd.old` if they exist:

```bash
# [ -e "/etc/security/opasswd" ] && chmod u-x,go-rwx /etc/security/opasswd
# [ -e "/etc/security/opasswd" ] && chown root:root /etc/security/opasswd
# [ -e "/etc/security/opasswd.old" ] && chmod u-x,go-rwx /etc/security/opasswd.old
# [ -e "/etc/security/opasswd.old" ] && chown root:root /etc/security/opasswd.old
```

## Default Value

/etc/security/opasswd Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1003, T1003.008, T1222, T1222.002 | TA0005  | M1022       |
