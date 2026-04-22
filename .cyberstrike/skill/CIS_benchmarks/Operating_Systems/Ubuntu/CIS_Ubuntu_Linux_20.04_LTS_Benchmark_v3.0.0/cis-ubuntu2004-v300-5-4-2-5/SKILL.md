---
name: cis-ubuntu2004-v300-5-4-2-5
description: "Ensure root path integrity"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.5 Ensure root path integrity (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `root` user can execute any command on the system and could be fooled into executing programs unintentionally if the `PATH` is not set correctly.

## Rationale

Including the current working directory (.) or other writable directory in `root`'s executable path makes it likely that an attacker can gain superuser access by forcing an administrator operating as `root` to execute a Trojan horse program.

## Audit Procedure

### Command Line

Run the following script to verify root's path does not include:

- Locations that are not directories
- An empty directory (`::`)
- A trailing (`:`)
- Current working directory (`.`)
- Non `root` owned directories
- Directories that less restrictive than mode `0755`

```bash
#!/usr/bin/env bash

{
  l_output2=""
  l_pmask="0022"
  l_maxperm="$( printf '%o' $(( 0777 & ~$l_pmask )) )"
  l_root_path="$(sudo -Hiu root env | grep '^PATH' | cut -d= -f2)"
  unset a_path_loc && IFS=":" read -ra a_path_loc <<< "$l_root_path"
  grep -q "::" <<< "$l_root_path" && l_output2="$l_output2\n - root's path contains a empty directory (::)"
  grep -Pq ":\h*$" <<< "$l_root_path" && l_output2="$l_output2\n - root's path contains a trailing (:)"
  grep -Pq '(\h+|:)\.(:|\h*$)' <<< "$l_root_path" && l_output2="$l_output2\n - root's path contains current working directory (.)"
  while read -r l_path; do
    if [ -d "$l_path" ]; then
      while read -r l_fmode l_fown; do
        [ "$l_fown" != "root" ] && l_output2="$l_output2\n - Directory: \"$l_path\" is owned by: \"$l_fown\" should be owned by \"root\""
        [ $(( $l_fmode & $l_pmask )) -gt 0 ] && l_output2="$l_output2\n - Directory: \"$l_path\" is mode: \"$l_fmode\" and should be mode: \"$l_maxperm\" or more restrictive"
        done <<< "$(stat -Lc '%#a %U' "$l_path")"
    else
      l_output2="$l_output2\n - \"$l_path\" is not a directory"
    fi
  done <<< "$(printf "%s\n" "${a_path_loc[@]}")"
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  *** PASS ***\n - Root's path is correctly configured\n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :\n$l_output2\n"
  fi
}
```

## Expected Result

```
- Audit Result:
  *** PASS ***
 - Root's path is correctly configured
```

## Remediation

### Command Line

Correct or justify any:

- Locations that are not directories
- Empty directories (`::`)
- Trailing (`:`)
- Current working directory (`.`)
- Non `root` owned directories
- Directories that less restrictive than mode `0755`

## Default Value

None specified.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 0.0 Explicitly Not Mapped (IG 0)

v7 - 0.0 Explicitly Not Mapped (IG 0)

MITRE ATT&CK Mappings: T1204, T1204.002 - Tactics: TA0006 - Mitigations: M1022
