---
name: cis-ubuntu1804-v220-4-2-2
description: "Ensure access to SSH private host key files is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

An SSH private host key is an SSH key pair used to authenticate the identity of the host to clients and should be accessible only by the owner (typically root) and the group (typically root or ssh key group).

## Rationale

If an unauthorized user obtains the SSH private host key, they could use it to impersonate the host or perform a man-in-the-middle attack.

## Audit Procedure

### Command Line

Run the following script to verify SSH private host key files have the correct permissions:

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2=""
  l_skgn="ssh_keys"
  l_skgid="$(awk -F: '($1 == "'"$l_skgn"'"){print $3}' /etc/group)"
  if [ -n "$l_skgid" ]; then
    l_aession="(root|$l_skgn)"
    l_agession="(0|$l_skgid)"
  else
    l_aession="root"
    l_agession="0"
  fi
  awk '{print}' <<< "$(find -L /etc/ssh -xdev -type f -exec stat -Lc '%n %#a %U %G %g' {} +)" | (
    while IFS= read -r l_file_mode; do
      l_file="$(awk '{print $1}' <<< "$l_file_mode")"
      if grep -Pq '\.pub$' <<< "$l_file"; then
        continue
      fi
      if file "$l_file" | grep -Pq 'SSH private key'; then
        l_mode="$(awk '{print $2}' <<< "$l_file_mode")"
        if [ $(( $l_mode & 0137 )) -gt 0 ]; then
          l_output2="$l_output2\n - File: \"$l_file\" is mode \"$l_mode\" should be mode: \"0600\" or more restrictive"
        fi
        l_owner="$(awk '{print $3}' <<< "$l_file_mode")"
        if [ "$l_owner" != "root" ]; then
          l_output2="$l_output2\n - File: \"$l_file\" is owned by: \"$l_owner\" should be owned by \"root\""
        fi
        l_group="$(awk '{print $4}' <<< "$l_file_mode")"
        l_gid="$(awk '{print $5}' <<< "$l_file_mode")"
        if ! grep -Pq "^$l_aession$" <<< "$l_group" || ! grep -Pq "^$l_agession$" <<< "$l_gid"; then
          l_output2="$l_output2\n - File: \"$l_file\" is group owned by: \"$l_group\" (GID: $l_gid) should belong to group \"$l_aession\""
        fi
      fi
    done
    if [ -z "$l_output2" ]; then
      echo -e "\n- Audit Result:\n  ** PASS **\n - All private SSH host key files have correct permissions"
    else
      echo -e "\n- Audit Result:\n  ** FAIL **\n - Reasons for audit failure:\n$l_output2"
    fi
  )
}
```

### Expected Result

```
** PASS ** - All private SSH host key files have correct permissions
```

## Remediation

### Command Line

Run the following commands to set permissions, ownership, and group on the private SSH host key files:

```bash
find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chmod u-x,g-wx,o-rwx {} \;
find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chown root:root {} \;
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know.

v7 - 14.6 Protect Information through Access Control Lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
