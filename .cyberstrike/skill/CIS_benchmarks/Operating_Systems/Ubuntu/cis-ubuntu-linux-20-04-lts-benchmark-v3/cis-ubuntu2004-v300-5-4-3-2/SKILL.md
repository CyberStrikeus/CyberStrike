---
name: cis-ubuntu2004-v300-5-4-3-2
description: "Ensure default user shell timeout is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.3.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3.2 Ensure default user shell timeout is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`TMOUT` is an environmental setting that determines the timeout of a shell in seconds.

- TMOUT=n - Sets the shell timeout to n seconds. A setting of `TMOUT=0` disables timeout.
- readonly TMOUT- Sets the TMOUT environmental variable as readonly, preventing unwanted modification during run-time.
- export TMOUT - exports the TMOUT variable

System Wide Shell Configuration Files:

- `/etc/profile` - used to set system wide environmental variables on users shells. The variables are sometimes the same ones that are in the `.bash_profile`, however this file is used to set an initial PATH or PS1 for all shell users of the system. is only executed for interactive login shells, or shells executed with the --login parameter.
- `/etc/profile.d` - `/etc/profile` will execute the scripts within `/etc/profile.d/*.sh`. It is recommended to place your configuration in a shell script within `/etc/profile.d` to set your own system wide environmental variables.
- `/etc/bash.bashrc` - System wide version of `.bashrc`. In Fedora derived distributions, `/etc/bashrc` also invokes /etc/profile.d/\*.sh if non-login shell, but redirects output to `/dev/null` if non-interactive. Is only executed for interactive shells or if `BASH_ENV` is set to `/etc/bash.bashrc`.

## Rationale

Setting a timeout value reduces the window of opportunity for unauthorized user access to another user's shell session that has been left unattended. It also ends the inactive session and releases the resources associated with that session.

## Audit Procedure

### Command Line

Run the following script to verify that `TMOUT` is configured to: include a timeout of no more than 900 seconds, to be `readonly`, to be `exported`, and is not being changed to a longer timeout.

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=(); l_tmout_set="900"
  f_tmout_read_chk()
  {
    a_out=(); a_out2=()
    l_tmout_readonly="$(grep -P -- '^\h*(typeset\h\-xr\hTMOUT\=\d+|([^\#\n\r]+)?\breadonly\h+TMOUT\b)' "$l_file")"
    l_tmout_export="$(grep -P -- '^\h*(typeset\h\-xr\hTMOUT\=\d+|([^\#\n\r]+)?\bexport\b([^\#\n\r]+\b)?TMOUT\b)' "$l_file")"
    if [ -n "$l_tmout_readonly" ]; then
      a_out+=(" - Readonly is set as: \"$l_tmout_readonly\" in: \"$l_file\"")
    else
      a_out2+=(" - Readonly is not set in: \"$l_file\"")
    fi
    if [ -n "$l_tmout_export" ]; then
      a_out+=(" - Export is set as: \"$l_tmout_export\" in: \"$l_file\"")
    else
      a_out2+=(" - Export is not set in: \"$l_file\"")
    fi
  }
  while IFS= read -r l_file; do
    l_tmout_value="$(grep -Po -- '^\h*([^\#\n\r]+)?\bTMOUT\=\d+\b' "$l_file" | awk -F= '{print $2}')"
    f_tmout_read_chk
    if [ -n "$l_tmout_value" ]; then
      if [[ "$l_tmout_value" -le "$l_tmout_set" && "$l_tmout_value" -gt "0" ]]; then
        a_output+=(" - TMOUT is set to: \"$l_tmout_value\" in: \"$l_file\"")
        [ "${#a_out[@]}" -gt 0 ] && a_output+=("${a_out[@]}")
        [ "${#a_out2[@]}" -gt 0 ] && a_output2+=("${a_out2[@]}")
      fi
      if [[ "$l_tmout_value" -gt "$l_tmout_set" || "$l_tmout_value" -le "0" ]]; then
        a_output2+=(" - TMOUT is incorrectly set to: \"$l_tmout_value\" in: \"$l_file\"")
        [ "${#a_out[@]}" -gt 0 ] && a_output2+=(" ** Incorrect TMOUT value *** ${a_out[@]}")
        [ "${#a_out2[@]}" -gt 0 ] && a_output2+=("${a_out2[@]}")
      fi
    else
      [ "${#a_out[@]}" -gt 0 ] && a_output2+=(" - TMOUT is not set" "${a_out[@]}")
      [ "${#a_out2[@]}" -gt 0 ] && a_output2+=(" - TMOUT is not set" "${a_out2[@]}")
    fi
  done < <(grep -Pls -- '^\h*([^\#\n\r]+)?\bTMOUT\b' /etc/*bashrc /etc/profile /etc/profile.d/*.sh)
  [[ "${#a_output[@]}" -le 0 && "${#a_output2[@]}" -le 0 ]] && a_output2+=(" - TMOUT is not configured")
  if [ -z "$l_output2" ]; then
    printf '%s\n' "" "- Audit Result:" "  ** PASS **" "${a_output[@]}"
  else
    printf '%s\n' "" "- Audit Result:" "  ** FAIL **" "  * Reasons for audit failure **" "${a_output2[@]}" ""
    [ -n "$l_output" ] && echo -e "\n- Correctly set:" "${a_output[@]}"
    [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "- Correctly set:" "${a_output[@]}"
  fi
}
```

Note: If `TMOUT` is set as `readonly` through `readonly TMOUT` and/or `typeset -xr` in more than once, you will receive an error message when logging into a terminal session or connecting with openSSH. It is recommended that `TMOUT` be set only once in only one file.

## Expected Result

Audit Result: ** PASS **

## Remediation

### Command Line

Review `/etc/bashrc`, `/etc/profile`, and all files ending in `*.sh` in the `/etc/profile.d/` directory and remove or edit all `TMOUT=_n_` entries to follow local site policy. `TMOUT` should not exceed 900 or be equal to 0.
Configure `TMOUT` in one of the following files:

- A file in the `/etc/profile.d/` directory ending in `.sh`
- `/etc/profile`
- `/etc/bashrc`

Example command to set TMOUT to 900 seconds in a file in `/etc/profile.d/`:

```bash
# printf '%s\n' "# Set TMOUT to 900 seconds" "typeset -xr TMOUT=900" > /etc/profile.d/50-tmout.sh
```

`TMOUT` configuration examples:

```
typeset -xr TMOUT=900
```

Deprecated methods:

- As multiple lines:

```
TMOUT=900
readonly TMOUT
export TMOUT
```

- As a single line:

```
readonly TMOUT=900 ; export TMOUT
```

Additional Information:

The audit and remediation in this recommendation apply to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked. Other methods of setting a timeout exist for other shells not covered here.

Ensure that the timeout conforms to your local policy.

## Default Value

None specified.

## References

None specified.

## CIS Controls

v8 - 4.3 Configure Automatic Session Locking on Enterprise Assets: Configure automatic session locking on enterprise assets after a defined period of inactivity. For general purpose operating systems, the period must not exceed 15 minutes. For mobile end-user devices, the period must not exceed 2 minutes. (IG 1, IG 2, IG 3)

v7 - 16.11 Lock Workstation Sessions After Inactivity: Automatically lock workstation sessions after a standard period of inactivity. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1078 - Tactics: TA0005 - Mitigations: M1026
