---
name: cis-ubuntu2004-v300-1-6-1
description: "Ensure /etc/motd is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, banners, motd, warning]
cis_id: "1.6.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.6.1 Ensure /etc/motd is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/motd` file are displayed to users after login and function as a message of the day for authenticated users.

Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information: `\m` - machine architecture `\r` - operating system release `\s` - operating system name `\v` - operating system version

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure

### Command Line

Run the following script to verify `MOTD` files do not contain system information:

```bash
#!/usr/bin/env bash

{
   l_output="" l_output2=""
   a_files=()
   for l_file in /etc/motd{,.d/*}; do
      if grep -Psqi -- "(\\\v|\\\r|\\\m|\\\s|\b$(grep ^ID= /etc/os-release | cut -d= -f2 | sed -e 's/"//g')\b)" "$l_file"; then
            l_output2="$l_output2\n - File: \"$l_file\" includes system information"
      else
            a_files+=("$l_file")
      fi
   done
   if [ "${#a_files[@]}" -gt 0 ]; then
      echo -e "\n-  ** Please review the following files and verify their contents follow local site policy **\n"
      printf '%s\n' "${a_files[@]}"
   elif [ -z "$l_output2" ]; then
      echo -e "- ** No MOTD files with any size were found. Please verify this conforms to local site policy **-"
   fi
   if [ -z "$l_output2" ]; then
      l_output=" - No MOTD files include system information"
      echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
   else
      echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
   fi
}
```

Review any files returned and verify that they follow local site policy.

## Expected Result

No MOTD files should include system information. Audit Result: ** PASS **

## Remediation

### Command Line

Edit the file found in `/etc/motd.d/*` with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, `\v` or references to the `OS platform`.

- OR -

- IF - the `motd` is not used, this file can be removed. Run the following command to remove the `motd` file:

```bash
# rm /etc/motd
```

Run the following script and review and/or update all returned files' contents to:

- Remove all system information (`\v`, `\r`; `\m`, `\s`)
- Remove any refence to the operating system
- Ensure contents follow local site policy

```bash
#!/usr/bin/env bash

{
   a_files=()
   for l_file in /etc/motd{,.d/*}; do
      if grep -Psqi -- "(\\\v|\\\r|\\\m|\\\s|\b$(grep ^ID= /etc/os-release | cut -d= -f2 | sed -e 's/"//g')\b)" "$l_file"; then
         echo -e "\n - File: \"$l_file\" includes system information. Edit this file to remove these entries"
      else
         a_files+=("$l_file")
      fi
   done
   if [ "${#a_files[@]}" -gt 0 ]; then
      echo -e "\n-  ** Please review the following files and verify their contents follow local site policy **\n"
      printf '%s\n' "${a_files[@]}"
   fi
}
```

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-1, CM-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 0.0 Explicitly Not Mapped | | | |

MITRE ATT&CK Mappings: T1082, T1082.000, T1592, T1592.004 | TA0007
