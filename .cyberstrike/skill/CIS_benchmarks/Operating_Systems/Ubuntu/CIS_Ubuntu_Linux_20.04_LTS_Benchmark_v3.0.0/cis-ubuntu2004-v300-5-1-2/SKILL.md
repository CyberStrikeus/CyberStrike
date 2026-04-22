---
name: cis-ubuntu2004-v300-5-1-2
description: "Ensure access to SSH private host key files is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to SSH private host key files is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

An SSH private key is one of two files used in SSH public key authentication. In this authentication method, the possession of the private key is proof of identity. Only a private key that corresponds to a public key will be able to authenticate successfully. The private keys need to be stored and handled carefully, and no copies of the private key should be distributed.

## Rationale

If an unauthorized user obtains the private SSH host key file, the host could be impersonated

## Audit Procedure

### Command Line

Run the following script to verify SSH private host key files are owned by the root user and either:

- owned by the group root and mode `0600` or more restrictive

- OR -

- owned by the group designated to own openSSH private keys and mode `0640` or more restrictive

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=()
  l_ssh_group_name="$(awk -F: '($1 ~ /^(ssh_keys|_?ssh)$/) {print $1}' /etc/group)"
  f_file_chk()
  {
    while IFS=: read -r l_file_mode l_file_owner l_file_group; do
      a_out2=()
      [ "$l_file_group" = "$l_ssh_group_name" ] && l_pmask="0137" || l_pmask="0177"
      l_maxperm="$( printf '%o' $(( 0777 & ~$l_pmask )) )"
      if [ $(( $l_file_mode & $l_pmask )) -gt 0 ]; then
        a_out2+=("      Mode: \"$l_file_mode\" should be mode: \"$l_maxperm\" or more restrictive")
      fi
      if [ "$l_file_owner" != "root" ]; then
        a_out2+=("      Owned by: \"$l_file_owner\" should be owned by \"root\"")
      fi
      if [[ ! "$l_file_group" =~ ($l_ssh_group_name|root) ]]; then
        a_out2+=("      Owned by group \"$l_file_group\" should be group owned by: \"$l_ssh_group_name\" or \"root\"")
      fi
      if [ "${#a_out2[@]}" -gt "0" ]; then
        a_output2+=(" - File: \"$l_file\"" "${a_out2[@]}")
      else
        a_output+=(" - File: \"$l_file\"" \
         "      Correct: mode: \"$l_file_mode\", owner: \"$l_file_owner\" and group owner: \"$l_file_group\" configured")
      fi
    done < <(stat -Lc '%#a:%U:%G' "$l_file")
  }
  while IFS= read -r -d $'\0' l_file; do
    if ssh-keygen -lf &>/dev/null "$l_file"; then
      file "$l_file" | grep -Piq -- '\bopenssh\h+([\^#\n\r]+\h+)?private\h+key\b' && f_file_chk
    fi
  done < <(find -L /etc/ssh -xdev -type f -print0 2>/dev/null)
  if [ "${#a_output2[@]}" -le 0 ]; then
    printf '%s\n' "" "- Audit Result:" " ** PASS **" "${a_output[@]}" ""
  else
    printf '%s\n' "" "- Audit Result:" " ** FAIL **" " - Reason(s) for audit failure:" "${a_output2[@]}"
    [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "" "- Correctly set:" "${a_output[@]}" ""
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

Run the following script to set mode, ownership, and group on the private SSH host key files:

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=(); l_ssh_group_name="$(awk -F: '($1 ~ /^(ssh_keys|_?ssh)$/) {print $1}' /etc/group)"
  f_file_access_fix()
  {
    while IFS=: read -r l_file_mode l_file_owner l_file_group; do
      a_out2=()
      [ "$l_file_group" = "$l_ssh_group_name" ] && l_pmask="0137" || l_pmask="0177"
      l_maxperm="$( printf '%o' $(( 0777 & ~$l_pmask )) )"
      if [ $(( $l_file_mode & $l_pmask )) -gt 0 ]; then
        a_out2+=("      Mode: \"$l_file_mode\" should be mode: \"$l_maxperm\" or more restrictive" \
         "      updating to mode: \"$l_maxperm\"")
        if [ "$l_file_group" = "$l_ssh_group_name" ]; then
          chmod u-x,g-wx,o-rwx "$l_file"
        else
          chmod u-x,go-rwx "$l_file"
        fi
      fi
      if [ "$l_file_owner" != "root" ]; then
        a_out2+=("      Owned by: \"$l_file_owner\" should be owned by \"root\"" \
         "      Changing ownership to \"root\"")
        chown root "$l_file"
      fi
      if [[ ! "$l_file_group" =~ ($l_ssh_group_name|root) ]]; then
        [ -n "$l_ssh_group_name" ] && l_new_group="$l_ssh_group_name" || l_new_group="root"
        a_out2+=("      Owned by group \"$l_file_group\" should be group owned by: \"$l_ssh_group_name\" or \"root\"" \
         "      Changing group ownership to \"$l_new_group\"")
        chgrp "$l_new_group" "$l_file"
      fi
      if [ "${#a_out2[@]}" -gt "0" ]; then
        a_output2+=(" - File: \"$l_file\"" "${a_out2[@]}")
      else
        a_output+=(" - File: \"$l_file\"" \
         "      Correct: mode: \"$l_file_mode\", owner: \"$l_file_owner\", and group owner: \"$l_file_group\" configured")
      fi
    done < <(stat -Lc '%#a:%U:%G' "$l_file")
  }
  while IFS= read -r -d $'\0' l_file; do
    if ssh-keygen -lf &>/dev/null "$l_file"; then
      file "$l_file" | grep -Piq -- '\bopenssh\h+([^#\n\r]+\h+)?private\h+key\b' && f_file_access_fix
    fi
  done < <(find -L /etc/ssh -xdev -type f -print0 2>/dev/null)
  if [ "${#a_output2[@]}" -le "0" ]; then
    printf '%s\n' "" " - No access changes required" ""
  else
    printf '%s\n' "" " - Remediation results:" "${a_output2[@]}" ""
  fi
}
```

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists
Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

MITRE ATT&CK Mappings: T1552, T1552.004 | TA0003, TA0006 | M1022
