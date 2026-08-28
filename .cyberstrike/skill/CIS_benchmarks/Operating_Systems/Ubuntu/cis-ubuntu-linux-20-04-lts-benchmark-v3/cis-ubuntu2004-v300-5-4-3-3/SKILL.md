---
name: cis-ubuntu2004-v300-5-4-3-3
description: "Ensure default user umask is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.3.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3.3 Ensure default user umask is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The user file-creation mode mask (`umask`) is used to determine the file permission for newly created directories and files. In Linux, the default permissions for any newly created directory is 0777 (`rwxrwxrwx`), and for any newly created file it is 0666 (`rw-rw-rw-`). The `umask` modifies the default Linux permissions by restricting (masking) these permissions. The `umask` is not simply subtracted, but is processed bitwise. Bits set in the `umask` are cleared in the resulting file mode.

`umask` can be set with either `Octal` or `Symbolic` values:

- `Octal` (Numeric) Value - Represented by either three or four digits. ie `umask 0027` or `umask 027`. If a four digit umask is used, the first digit is ignored. The remaining three digits effect the resulting permissions for user, group, and world/other respectively.
- `Symbolic` Value - Represented by a comma separated list for User `u`, group `g`, and world/other `o`. The permissions listed are not masked by `umask`. ie a `umask` set by `umask u=rwx,g=rx,o=` is the `Symbolic` equivalent of the `Octal` umask `027`. This `umask` would set a newly created directory with file mode `drwxr-x---` and a newly created file with file mode `rw-r-----`.

The default `umask` can be set to use the `pam_umask` module or in a `System Wide Shell Configuration File`. The user creating the directories or files has the discretion of changing the permissions via the chmod command, or choosing a different default `umask` by adding the `umask` command into a `User Shell Configuration File`, (`.bash_profile` or `.bashrc`), in their home directory.

Setting the default umask:

- pam_umask module:
  - will set the umask according to the system default in `/etc/login.defs` and user settings, solving the problem of different `umask` settings with different shells, display managers, remote sessions etc.
  - `umask=<mask>` value in the `/etc/login.defs` file is interpreted as Octal
  - Setting `USERGROUPS_ENAB` to yes in `/etc/login.defs` (default):
    - will enable setting of the `umask` group bits to be the same as owner bits. (examples: 022 -> 002, 077 -> 007) for non-root users, if the `uid` is the same as `gid`, and `username` is the same as the `<primary group name>`
    - userdel will remove the user's group if it contains no more members, and useradd will create by default a group with the name of the user

- `System Wide Shell Configuration File`:
  - `/etc/profile` - used to set system wide environmental variables on users shells. The variables are sometimes the same ones that are in the `.bash_profile`, however this file is used to set an initial PATH or PS1 for all shell users of the system. is only executed for interactive login shells, or shells executed with the --login parameter.
  - `/etc/profile.d` - `/etc/profile` will execute the scripts within `/etc/profile.d/*.sh`. It is recommended to place your configuration in a shell script within `/etc/profile.d` to set your own system wide environmental variables.
  - `/etc/bashrc` - System wide version of `.bashrc`. In Fedora derived distributions, `etc/bashrc` also invokes /etc/profile.d/\*.sh if non-login shell, but redirects output to `/dev/null` if non-interactive. Is only executed for interactive shells or if `BASH_ENV` is set to `/etc/bashrc`.

User Shell Configuration Files:

- `~/.bash_profile` - Is executed to configure your shell before the initial command prompt. Is only read by login shells.
- `~/.bashrc` - Is executed for interactive shells. only read by a shell that's both interactive and non-login

`umask` is set by order of precedence. If `umask` is set in multiple locations, this order of precedence will determine the system's default `umask`.

Order of precedence:

1. A file in `/etc/profile.d/` ending in `.sh` - This will override any other system-wide `umask` setting
2. In the file `/etc/profile`
3. On the `pam_umask.so` module in `/etc/pam.d/postlogin`
4. In the file `/etc/login.defs`
5. In the file `/etc/default/login`

## Rationale

Setting a secure default value for `umask` ensures that users make a conscious choice about their file permissions. A permissive `umask` value could result in directories or files with excessive permissions that can be read and/or written to by unauthorized users.

## Audit Procedure

### Command Line

Run the following to verify the default user `umask` is set to `027`(octal) or `u=rwx,g=rx,o=` (Symbolic) to enforce newly created directories' permissions to be `750` (`drwxr-x---`), and newly created file's permissions be `640` (`rw-r-----`), or more restrictive:

```bash
#!/usr/bin/env bash

{
  l_output="" l_output2=""
  file_umask_chk()
  {
    if grep -Psiq -- '^\h*umask\h+(0?[0-7][2-7]7|u=(rwx]{0,3}),g=([rx]{0,2}),o=)\h*#.*?$' "$l_file"; then
      l_output="$l_output\n - umask is set correctly in \"$l_file\""
    elif grep -Psiq -- '^\h*umask\h+(([0-7][0-7][01][0-7]\b|[0-7][0-7][0-7][0-6]\b)|([0-7][01][0-7]\b|[0-7][0-7][0-6]\b)|(u=[rwx]{1,3},)?((g=[rx]?[rx]?w[rx]?[rx]?\b)(,o=[rwx]{1,3})?|((g=[wrx]{1,3},)?o=[wrx]{1,3}\b)))' "$l_file"; then
      l_output2="$l_output2\n - umask is incorrectly set in \"$l_file\""
    fi
  }
  while IFS= read -r -d $'\0' l_file; do
    file_umask_chk
  done < <(find /etc/profile.d/ -type f -name '*.sh' -print0)
  [ -z "$l_output" ] && l_file="/etc/profile" && file_umask_chk
  [ -z "$l_output" ] && l_file="/etc/bashrc" && file_umask_chk
  [ -z "$l_output" ] && l_file="/etc/bash.bashrc" && file_umask_chk
  [ -z "$l_output" ] && l_file="/etc/pam.d/postlogin"
  [ -z "$l_output" ] && l_file="/etc/login.defs" && file_umask_chk
  [ -z "$l_output" ] && l_file="/etc/default/login" && file_umask_chk
  if [ -z "$l_output" ]; then
    if grep -Psiq '^\h*session\h+[^\#\n\r]+\h+pam_umask\.so\h+([^\#\n\r]+\h+)?umask=(0?[0-7][2-7]7)\b' "$l_file"; then
      l_output1="$l_output1\n - umask is set correctly in \"$l_file\""
      elif grep -Psiq '^\h*session\h+[^\#\n\r]+\h+pam_umask\.so\h+([^\#\n\r]+\h+)?umask=([0-7][0-7][01][0-7]\b)|([0-7][01][0-7]\b)' "$l_file"; then
        l_output2="$l_output2\n - umask is incorrectly set in \"$l_file\""
    fi
  fi
  [ -z "$l_output" ] && l_file="/etc/login.defs" && file_umask_chk
  [ -z "$l_output" ] && l_file="/etc/default/login" && file_umask_chk
  [[ -z "$l_output" && -z "$l_output2" ]] && l_output2="$l_output2\n - umask is not set"
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n - * Correctly configured * :\n$l_output\n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :\n$l_output2"
    [ -n "$l_output" ] && echo -e "\n- * Correctly configured * :\n$l_output\n"
  fi
}
```

## Expected Result

```
- Audit Result:
  ** PASS **
```

## Remediation

### Command Line

Configure the default user `umask` according to your organization's security policy. The recommended value is `027` or more restrictive.

The `umask` can be configured in one of the following locations (in order of precedence):

1. A file in `/etc/profile.d/` ending in `.sh`
2. `/etc/profile`
3. `pam_umask.so` module in `/etc/pam.d/postlogin`
4. `/etc/login.defs`
5. `/etc/default/login`

## Default Value

System default `umask`

## References

None specified.

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1083 - Tactics: TA0007
