---
name: cis-ubuntu1804-v220-4-5-4
description: "Ensure default user umask is 027 or more restrictive"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, account-security]
cis_id: "4.5.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The user file-creation mode mask (`umask`) is used to determine the file permission for newly created directories and files. In Linux, the default permissions for any newly created directory is 0777 (rwxrwxrwx), and for any newly created file it is 0666 (rw-rw-rw-). The `umask` modifies the default Linux permissions by restricting (masking) these permissions. The `umask` is not simply subtracted, but is processed bitwise. Bits set in the `umask` are cleared in the resulting file mode.

## Rationale

Setting a very secure default value for `umask` ensures that users make a conscious choice about their file permissions. A default `umask` setting of `077` causes files and directories created by users to not be readable by any other user on the system. A `umask` of `027` would make files and directories readable by users in the same Unix group, while a `umask` of `022` would make files readable by every user on the system.

## Impact

Setting `USERGROUPS_ENAB no` in `/etc/login.defs` may change the expected behavior of `useradd` and `userdel`.

## Audit Procedure

### Command Line

Run the following script to verify that a default user umask is set enforcing a newly created directory's permissions to be 750 (drwxr-x---), and a newly created file's permissions be 640 (rw-r-----), or more restrictive:

```bash
#!/bin/bash
passing=""
grep -Eiq '^\s*UMASK\s+(0[0-7][2-7]7|[0-7][2-7]7)\b' /etc/login.defs && grep -Eqi '^\s*USERGROUPS_ENAB\s*"?no"?\b' /etc/login.defs && grep -Eq '^\s*session\s+(optional|requisite|required)\s+pam_umask\.so\b' /etc/pam.d/common-session && passing=true
grep -REiq '^\s*UMASK\s+\s*(0[0-7][2-7]7|[0-7][2-7]7)\b|u=(r?x?|r?w?x?)(r?w?|x?)(r?w?|x?),g=(r?x?|x?r?),o=)\b' /etc/profile* /etc/bash.bashrc* && passing=true
[ "$passing" = true ] && echo "Default user umask is set"
```

Verify output is: "Default user umask is set"

Run the following to verify that no less restrictive system wide umask is set:

```bash
grep -RPi '{^|^[^#]*}\s*umask\s+([0-7][0-7][01][0-7]\b|[0-7][0-7][0-7][0-6]\b|[0-7][01][0-7]\b|[0-7][0-7][0-6])\b|{u=[rwx]{1,3},}?g=[^rx]{1,3}(,o=[rwx]{0,3})?)\b)' /etc/login.defs /etc/profile* /etc/bash.bashrc*
```

No file should be returned.

## Remediation

### Command Line

Follow one of the following methods to set the default user umask:

Edit `/etc/login.defs` and edit the `UMASK` and `USERGROUPS_ENAB` lines as follows:

```
UMASK 027
USERGROUPS_ENAB no
```

Edit `/etc/pam.d/common-session` and add or edit the following:

```
session optional          pam_umask.so
```

OR configure umask in one of the following files:

- A file in the `/etc/profile.d/` directory ending in .sh
- `/etc/profile`
- `/etc/bash.bashrc`

Example: `/etc/profile.d/set_umask.sh`

```
umask 027
```

Note: this method only applies to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked.

## Default Value

UMASK 022

## References

1. pam_umask(8)
2. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know.

v7 - 14.6 Protect Information through Access Control Lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
