---
name: cis-ubuntu2004-v300-5-1-1
description: "Ensure access to /etc/ssh/sshd_config is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to /etc/ssh/sshd_config is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The file `/etc/ssh/sshd_config`, and files ending in `.conf` in the `/etc/ssh/sshd_config.d` directory, contain configuration specifications for `sshd`.

## Rationale

Configuration specifications for `sshd` need to be protected from unauthorized changes by non-privileged users.

## Audit Procedure

### Command Line

Run the following script and verify `/etc/ssh/sshd_config` and files ending in `.conf` in the `/etc/ssh/sshd_config.d` directory are:

- Mode `0600` or more restrictive
- Owned by the `root` user
- Group owned by the group `root`.

```bash
#!/usr/bin/env bash

{
  a_output=(); a_output2=()
  perm_mask='0177' && maxperm="$( printf '%o' $(( 0777 & ~$perm_mask )) )"
  f_sshd_files_chk()
  {
    while IFS=: read -r l_mode l_user l_group; do
      a_out2=()
      [ $(( $l_mode & $perm_mask )) -gt 0 ] && a_out2+=("      Is mode: \"$l_mode\" \
       should be mode: \"$maxperm\" or more restrictive")
      [ "$l_user" != "root" ] && a_out2+=("      Is owned by \"$l_user\" should be owned by \"root\"")
      [ "$l_group" != "root" ] && a_out2+=("      Is group owned by \"$l_user\" should be group owned by \"root\"")
      if [ "${#a_out2[@]}" -gt "0" ]; then
        a_output2+=(" - File: \"$l_file\":" "${a_out2[@]}")
      else
        a_output+=(" - File: \"$l_file\":" "      Correct: mode ($l_mode), owner ($l_user) \
         and group owner ($l_group) configured")
      fi
    done < <(stat -Lc '%#a:%U:%G' "$l_file")
  }
  {
    [ -e "/etc/ssh/sshd_config" ] && l_file="/etc/ssh/sshd_config" && f_sshd_files_chk
    while IFS= read -r -d $'\0' l_file; do
      [ -e "$l_file" ] && f_sshd_files_chk
    done < <(find /etc/ssh/sshd_config.d -type f -name '*.conf' \( -perm /077 -o ! -user root -o ! -group root \) -print0 2>/dev/null)
  }
  if [ "${#a_output2[@]}" -le 0 ]; then
    printf '%s\n' "" "- Audit Result:" " ** PASS **" "${a_output[@]}" ""
  else
    printf '%s\n' "" "- Audit Result:" " ** FAIL **" " - Reason(s) for audit failure:" "${a_output2[@]}"
    [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "" "- Correctly set:" "${a_output[@]}" ""
  fi
}
```

- IF - other locations are listed in an `Include` statement, `*.conf` files in these locations should also be checked.

## Expected Result

```
- Audit Result:
 ** PASS **
```

## Remediation

### Command Line

Run the following script to set ownership and permissions on `/etc/ssh/sshd_config` and files ending in `.conf` in the `/etc/ssh/sshd_config.d` directory:

```bash
#!/usr/bin/env bash

{
  chmod u-x,og-rwx /etc/ssh/sshd_config
  chown root:root /etc/ssh/sshd_config
  while IFS= read -r -d $'\0' l_file; do
    if [ -e "$l_file" ]; then
      chmod u-x,og-rwx "$l_file"
      chown root:root "$l_file"
    fi
  done < <(find /etc/ssh/sshd_config.d -type f -print0 2>/dev/null)
}
```

- IF - other locations are listed in an `Include` statement, `*.conf` files in these locations access should also be modified.

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists
Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

MITRE ATT&CK Mappings: T1098, T1098.004, T1543, T1543.002 | TA0005 | M1022
