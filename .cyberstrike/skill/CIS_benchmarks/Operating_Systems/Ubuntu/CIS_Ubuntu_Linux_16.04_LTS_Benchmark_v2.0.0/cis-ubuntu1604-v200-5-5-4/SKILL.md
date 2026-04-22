---
name: cis-ubuntu1604-v200-5-5-4
description: "Ensure default user umask is 027 or more restrictive"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure default user umask is 027 or more restrictive

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The user file-creation mode mask (`umask`) is use to determine the file permission for newly created directories and files. In Linux, the default permissions for any newly created directory is 0777 (rwxrwxrwx), and for any newly created file it is 0666 (rw-rw-rw-). The `umask` modifies the default Linux permissions by restricting (masking) these permissions. The `umask` is not simply subtracted, but is processed bitwise. Bits set in the `umask` are cleared in the resulting file mode.

`umask` can be set with either `Octal` or `Symbolic` values:

- `Octal` (Numeric) Value - Represented by either three or four digits. ie `umask 0027` or `umask 027`. If a four digit umask is used, the first digit is ignored. The remaining three digits effect the resulting permissions for user, group, and world/other respectively.
- `Symbolic` Value - Represented by a comma separated list for User `u`, group `g`, and world/other `o`. The permissions listed are not masked by `umask`. ie a `umask` set by `umask u=rwx,g=rx,o=` is the `Symbolic` equivalent of the `Octal` `umask 027`. This `umask` would set a newly created directory with file mode `drwxr-x---` and a newly created file with file mode `rw-r-----`.

Setting the default `umask`:

- `pam_umask` module:
  - will set the umask according to the system default in `/etc/login.defs` and user settings, solving the problem of different `umask` settings with different shells, display managers, remote sessions etc.
  - `umask=<mask>` value in the `/etc/login.defs` file is interpreted as Octal
  - Setting `USERGROUPS_ENAB` to `yes` in `/etc/login.defs` (default): will enable setting of the umask group bits to be the same as owner bits. (examples: 022 -> 002, 077 -> 007) for non-root users, if the uid is the same as gid, and username is the same as the primary group name
    - `userdel` will remove the user's group if it contains no more members, and `useradd` will create by default a group with the name of the user

- System Wide Shell Configuration File:
  - `/etc/profile` - used to set system wide environmental variables on users shells. Is only executed for interactive login shells, or shells executed with the --login parameter.
  - `/etc/profile.d` - `/etc/profile` will execute the scripts within `/etc/profile.d/*.sh`. It is recommended to place your configuration in a shell script within `/etc/profile.d` to set your own system wide environmental variables.
  - `/etc/bash.bashrc` - System wide version of `.bashrc`. `etc/bash.bashrc` also invokes `/etc/profile.d/*.sh` if non-login shell, but redirects output to `/dev/null` if non-interactive. Is only executed for interactive shells or if `BASH_ENV` is set to `/etc/bash.bashrc`.

## Rationale

Setting a very secure default value for `umask` ensures that users make a conscious choice about their file permissions. A default `umask` setting of `077` causes files and directories created by users to not be readable by any other user on the system. A `umask` of `027` would make files and directories readable by users in the same Unix group, while a `umask` of `022` would make files readable by every user on the system.

## Impact

Setting `USERGROUPS_ENAB no` in `/etc/login.defs` may change the expected behavior of `useradd` and `userdel`.

Setting `USERGROUPS_ENAB yes` in `/etc/login.defs`:
- `userdel` will remove the user's group if it contains no more members
- `useradd` will create by default a group with the name of the user.

## Audit Procedure

### Command Line

Run the following to verify:

- A default user umask is set to enforce a newly created directories's permissions to be 750 (drwxr-x---), and a newly created file's permissions be 640 (rw-r-----), or more restrictive
- No less restrictive System Wide `umask` is set

Run the following script to verify that a default user umask is set enforcing a newly created directories's permissions to be 750 (drwxr-x---), and a newly created file's permissions be 640 (rw-r-----), or more restrictive:

```bash
#!/bin/bash
passing=""
grep -Eiq '^\s*UMASK\s+(0[0-7][2-7]7|[0-7][2-7]7)\b' /etc/login.defs && grep -Eqi '^\s*USERGROUPS_ENAB\s*"?no"?\b' /etc/login.defs && grep -Eq '^\s*session\s+(optional|requisite|required)\s+pam_umask\.so\b' /etc/pam.d/common-session && passing=true
grep -REiq '^\s*UMASK\s+\s*(0[0-7][2-7]7|[0-7][2-7]7|u=(r?|w?|x?)(r?|w?|x?)(r?|w?|x?),g=(r?x?|x?r?),o=)\b' /etc/profile* /etc/bash.bashrc* && passing=true
[ "$passing" = true ] && echo "Default user umask is set"
```

**Expected output:** "Default user umask is set"

Run the following to verify that no less restrictive system wide umask is set:

```bash
grep -RPi '(^|^[^#]*)\s*umask\s+(0[0-7][0-1][0-7]\b|[0-7][0-7][0-7][0-6]\b|[0-7][0-1][0-7]\b|[0-7][0-7][0-6]\b|(u=[rwx]{0,3},)?{g=[rwx]{0,3},)?o=[rwx]+\b|(u=[rwx]{1,3},)?g=[^rx]{1,3}(,o=[rwx]{0,3})?\b)' /etc/login.defs /etc/profile* /etc/bash.bashrc*
```

**Expected Result:**

No file should be returned.

## Remediation

### Command Line

Run the following command and remove or modify the `umask` of any returned files:

```bash
grep -RPi '(^|^[^#]*)\s*umask\s+(0[0-7][0-1][0-7]\b|[0-7][0-7][0-7][0-6]\b|[0-7][0-1][0-7]\b|[0-7][0-7][0-6]\b|(u=[rwx]{0,3},)?{g=[rwx]{0,3},)?o=[rwx]+\b|(u=[rwx]{1,3},)?g=[^rx]{1,3}(,o=[rwx]{0,3})?\b)' /etc/login.defs /etc/profile* /etc/bash.bashrc*
```

Follow **one** of the following methods to set the default user umask:

Edit `/etc/login.defs` and edit the `UMASK` and `USERGROUPS_ENAB` lines as follows:

```
UMASK 027
USERGROUPS_ENAB no
```

Edit `/etc/pam.d/common-session` and add or edit the following:

```
session optional                        pam_umask.so
```

**OR**

Configure umask in one of the following files:

- A file in the `/etc/profile.d/` directory ending in .sh
- `/etc/profile`
- `/etc/bash.bashrc`

*Example:* `/etc/profile.d/set_umask.sh`

```
umask 027
```

**Note:** this method only applies to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked.

## Default Value

UMASK 022

## References

1. pam_umask(8)

## Additional Information

- Other methods of setting a default user `umask` exist.
- If other methods are in use in your environment they should be audited.
- The default user `umask` can be overridden with a user specific `umask`.
- The user creating the directories or files has the discretion of changing the permissions:
  - Using the `chmod` command
  - Setting a different default `umask` by adding the `umask` command into a User Shell Configuration File, (`.bashrc`), in their home directory
  - Manually changing the umask for the duration of a login session by running the `umask` command

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
