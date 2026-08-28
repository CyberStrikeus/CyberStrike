---
name: cis-ubuntu2004-v300-5-1-3
description: "Ensure access to SSH public host key files is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to SSH public host key files is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

An SSH public key is one of two files used in SSH public key authentication. In this authentication method, a public key is a key that can be used for verifying digital signatures generated using a corresponding private key. Only a public key that corresponds to a private key will be able to authenticate successfully.

## Rationale

If a public host key file is modified by an unauthorized user, the SSH service may be compromised.

## Audit Procedure

### Command Line

Run the following command and verify Access does not grant write or execute permissions to group or other for all returned files:
Run the following script to verify SSH public host key files are mode `0644` or more restrictive, owned by the `root` user, and owned by the `root` group:

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=()
  l_pmask="0133"; l_maxperm="$( printf '%o' $(( 0777 & ~$l_pmask )) )"
  f_file_chk()
  {
    while IFS=: read -r l_file_mode l_file_owner l_file_group; do
      a_out2=()
      if [ $(( $l_file_mode & $l_pmask )) -gt 0 ]; then
        a_out2+=("      Mode: \"$l_file_mode\" should be mode: \"$l_maxperm\" or more restrictive")
      fi
      if [ "$l_file_owner" != "root" ]; then
        a_out2+=("      Owned by: \"$l_file_owner\" should be owned by: \"root\"")
      fi
      if [ "$l_file_group" != "root" ]; then
        a_out2+=("      Owned by group \"$l_file_group\" should be group owned by group: \"root\"")
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
      file "$l_file" | grep -Piq -- '\bopenssh\h+([^#\n\r]+\h+)?public\h+key\b' && f_file_chk
    fi
  done < <(find -L /etc/ssh -xdev -type f -print0 2>/dev/null)
  if [ "${#a_output2[@]}" -le 0 ]; then
    [ "${#a_output[@]}" -le 0 ] && a_output+=(" - No openSSH public keys found")
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

Run the following script to set mode, ownership, and group on the public SSH host key files:

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=()
  l_pmask="0133"; l_maxperm="$( printf '%o' $(( 0777 & ~$l_pmask )) )"
  f_file_access_fix()
  {
    while IFS=: read -r l_file_mode l_file_owner l_file_group; do
      a_out2=()
      [ $(( $l_file_mode & $l_pmask )) -gt 0 ] && \
        a_out2+=("      Mode: \"$l_file_mode\" should be mode: \"$l_maxperm\" or more restrictive" \
         "      updating to mode: \"$l_maxperm\"") && chmod u-x,go-wx "$l_file"
      [ "$l_file_owner" != "root" ] && \
        a_out2+=("      Owned by: \"$l_file_owner\" should be owned by \"root\"" \
         "      Changing ownership to \"root\"") && chown root "$l_file"
      [ "$l_file_group" != "root" ] && \
        a_out2+=("      Owned by group \"$l_file_group\" should be group owned by: \"root\"" \
         "      Changing group ownership to \"root\"") && chgrp root "$l_file"
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
      file "$l_file" | grep -Piq -- '\bopenssh\h+([^#\n\r]+\h+)?public\h+key\b' && f_file_access_fix
    fi
  done < <(find -L /etc/ssh -xdev -type f -print0 2>/dev/null)
  if [ "${#a_output2[@]}" -le "0" ]; then
    printf '%s\n' "" " - No access changes required" ""
  else
    printf '%s\n' "" " - Remediation results:" "${a_output2[@]}" ""
  fi
}
```

## Default Value

644 0/root 0/root

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists
Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

MITRE ATT&CK Mappings: T1557, T1557.000 | TA0003, TA0006 | M1022
