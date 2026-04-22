---
name: cis-ubuntu1604-v200-5-5-5
description: "Ensure default user shell timeout is 900 seconds or less"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure default user shell timeout is 900 seconds or less

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

`TMOUT` is an environmental setting that determines the timeout of a shell in seconds.

- `TMOUT=n` - Sets the shell timeout to *n* seconds. A setting of `TMOUT=0` disables timeout.
- `readonly TMOUT` - Sets the TMOUT environmental variable as readonly, preventing unwanted modification during run-time.
- `export TMOUT` - exports the TMOUT variable

System Wide Shell Configuration Files:

- `/etc/profile` - used to set system wide environmental variables on users shells. The variables are sometimes the same ones that are in the `.bash_profile`, however this file is used to set an initial PATH or PS1 for all shell users of the system. *Is only executed for interactive login shells, or shells executed with the --login parameter.*
- `/etc/profile.d` - `/etc/profile` will execute the scripts within `/etc/profile.d/*.sh`. It is recommended to place your configuration in a shell script within `/etc/profile.d` to set your own system wide environmental variables.
- `/etc/bash.bashrc` - System wide version of `bash.bashrc`. `etc/bash.bashrc` also invokes `/etc/profile.d/*.sh` if non-login shell, but redirects output to `/dev/null` if non-interactive. *Is only executed for interactive shells or if `BASH_ENV` is set to `/etc/bash.bashrc`.*

## Rationale

Setting a timeout value reduces the window of opportunity for unauthorized user access to another user's shell session that has been left unattended. It also ends the inactive session and releases the resources associated with that session.

## Audit Procedure

### Command Line

Run the following commands to verify that `TMOUT` is configured to include a timeout of no more than `900` seconds, to be `readonly`, and to be `exported`:

Run the following command to verify that `TMOUT` is configured in: a `.sh` file in `/etc/profile.d/`, in `/etc/profile`, or in `/etc/bash.bashrc`:

```bash
for f in /etc/bash.bashrc /etc/profile /etc/profile.d/*.sh ; do grep -Eq '(^|^[^#]*;)\s*(readonly|export(\s+[^$#;]+\s*)*)?\s*TMOUT=(900|[1-8][0-9][0-9]|[0-9][1-9][0-9]|[1-9][0-9])\b' $f && grep -Eq '(^|^[^#]*;)\s*readonly\s+TMOUT\b' $f && grep -Eq '(^|^[^#]*;)\s*export\s+([^$#;]+\s+)*TMOUT\b' $f && echo "TMOUT correctly configured in file: $f"; done
```

**Expected output:**

```
TMOUT correctly configured in file: <name of file where TMOUT is configured>
```

Run the following command to verify that `TMOUT` is not being changed to a longer timeout:

```bash
grep -P '^\s*([^$#;]+\s+)*TMOUT=(9[0-9][1-9]|0+|[1-9]\d{3,})\b\s*(\S+\s*)*(\s+#.*)?$' /etc/profile /etc/profile.d/*.sh /etc/bash.bashrc
```

**Expected Result:**

Nothing should be returned.

## Remediation

### Command Line

Review `/etc/bash.bashrc`, `/etc/profile`, and all files ending in `*.sh` in the `/etc/profile.d/` directory and remove or edit all `TMOUT=_n_` entries to follow local site policy. `TMOUT` should not exceed 900 or be equal to 0.

Configure `TMOUT` in **one** of the following files:

- A file in the `/etc/profile.d/` directory ending in `.sh`
- `/etc/profile`
- `/etc/bash.bashrc`

`TMOUT` configuration examples:

- As multiple lines:

```bash
TMOUT=900
readonly TMOUT
export TMOUT
```

- As a single line:

```bash
readonly TMOUT=900 ; export TMOUT
```

## Additional Information

The audit and remediation in this recommendation apply to bash and shell. If other shells are supported on the system, it is recommended that their configuration files are also checked.

Other methods of setting a timeout exist not covered here.

## References

None

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 16.11 Lock Workstation Sessions After Inactivity - Automatically lock workstation sessions after a standard period of inactivity. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
