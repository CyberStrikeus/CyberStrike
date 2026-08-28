---
name: cis-ubuntu1804-v220-4-5-5
description: "Ensure default user shell timeout is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, account-security]
cis_id: "4.5.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.5

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`TMOUT` is an environmental setting that determines the timeout of a shell in seconds.

- `TMOUT=n` - Sets the shell timeout to n seconds. A setting of `TMOUT=0` disables timeout.
- `readonly TMOUT` - Sets the TMOUT environmental variable as readonly, preventing unwanted modification during run-time.
- `export TMOUT` - exports the TMOUT variable

System Wide Shell Configuration Files:

- `/etc/profile` - used to set system wide environmental variables on users shells. Is only executed for interactive login shells, or shells executed with the --login parameter.
- `/etc/profile.d` - `/etc/profile` will execute the scripts within `/etc/profile.d/*.sh`. It is recommended to place your configuration in a shell script within `/etc/profile.d` to set your own system wide environmental variables.
- `/etc/bash.bashrc` - System wide version of `.bashrc`. `/etc/bash.bashrc` also invokes `/etc/profile.d/*.sh` if non-login shell, but redirects output to `/dev/null` if non-interactive. Is only executed for interactive shells or if `BASH_ENV` is set to `/etc/bash.bashrc`.

## Rationale

Setting a timeout value reduces the window of opportunity for unauthorized user access to another user's shell session that has been left unattended. It also ends the inactive session and releases the resources associated with that session.

## Audit Procedure

### Command Line

Run the following script to verify `TMOUT` is configured:

- as multiple lines, or a single line
- once, and only once
- in one and only one of the following locations:
  - A file in the `/etc/profile.d/` directory ending in `.sh`
  - `/etc/profile`
  - `/etc/bash.bashrc`
- Follows local site policy:
  - Not to exceed `900`
  - Not equal to `0`
- to be readonly
- to be exported

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2=""
  l_tmv_max="900"
  l_searchloc="/etc/bashrc /etc/bash.bashrc /etc/profile /etc/profile.d/*.sh"
  a_tmofile=()
  while read -r l_file; do
    [ -e "$l_file" ] && a_tmofile+=("$(readlink -f $l_file)")
  done < <(grep -PRils '^\h*([^#\n\r]+\h+)?TMOUT=\d+\b' $l_searchloc)
  if ! (( ${#a_tmofile[@]} > 0 )); then
    l_output2="$l_output2\n - TMOUT is not set"
  elif (( ${#a_tmofile[@]} > 1 )); then
    l_output2="$l_output2\n - TMOUT is set in multiple locations.\n - List of files where TMOUT is set:\n$(printf '%s\n' "${a_tmofile[@]}")\n  - end of list\n"
  else
    for l_file in ${a_tmofile[@]}; do
      if (( "$(grep -Pci '^\h*([^#\n\r]+\h+)?TMOUT=\d+' "$l_file")" > 1 )); then
        l_output2="$l_output2\n - TMOUT is set multiple times in \"$l_file\""
      else
        l_tmv="$(grep -Pi '^\h*([^#\n\r]+\h+)?TMOUT=\d+' "$l_file" | grep -Po '\d+')"
        if (( "$l_tmv" > "$l_tmv_max" )); then
          l_output2="$l_output2\n - TMOUT is \"$l_tmv\" in \"$l_file\"\n - Should be \"$l_tmv_max\" or less and not \"0\""
        else
          l_output="$l_output\n- TMOUT is correctly set to \"$l_tmv\" in \"$l_file\""
          if grep -Piq '^\h*([^#\n\r]+\h+)?readonly\h+TMOUT\b' "$l_file"; then
            l_output="$l_output\n- TMOUT is correctly set to \"readonly\" in \"$l_file\""
          else
            l_output2="$l_output2\n- TMOUT is not set to \"readonly\""
          fi
          if grep -Piq '^\h*\h*([^#\n\r]+\h*;\h*)export\h+TMOUT\b' "$l_file"; then
            l_output="$l_output\n- TMOUT is correctly set to \"export\" in \"$l_file\""
          else
            l_output2="$l_output2\n- TMOUT is not set to \"export\""
          fi
        fi
      fi
    done
  fi
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n - Correctly configured * :$l_output\n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - Reasons for audit failure * :$l_output2"
    [ -n "$l_output" ] && echo -e "- * Correctly configured * :$l_output\n"
  fi
}
```

### Expected Result

```
** PASS ** - Correctly configured
```

## Remediation

### Command Line

Review `/etc/bash.bashrc`, `/etc/profile`, and all files ending in `*.sh` in the `/etc/profile.d/` directory and remove or edit all `TMOUT=_n_` entries to follow local site policy.

TMOUT should:

- Be configured once, as multiple lines, or a single line, in one and only one of the following locations:
  - A file in the `/etc/profile.d/` directory ending in `.sh`
  - `/etc/profile`
  - `/etc/bash.bashrc`
- Not exceed `900`
- Not be equal to `0`

Multiple line example:

```bash
TMOUT=900
readonly TMOUT
export TMOUT
```

Single line example:

```bash
readonly TMOUT=900 ; export TMOUT
```

## References

1. NIST SP 800-53 Rev. 5: AC-11

## CIS Controls

v8 - 4.3 Configure Automatic Session Locking on Enterprise Assets - Configure automatic session locking on enterprise assets after a defined period of inactivity.

v7 - 16.11 Lock Workstation Sessions After Inactivity.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
