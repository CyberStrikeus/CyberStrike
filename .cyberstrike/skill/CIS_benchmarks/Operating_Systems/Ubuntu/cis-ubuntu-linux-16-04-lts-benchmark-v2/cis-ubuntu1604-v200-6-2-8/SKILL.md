---
name: cis-ubuntu1604-v200-6-2-8
description: "Ensure no users have .netrc files"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.8"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.8

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The `.netrc` file contains data for logging into a remote host for file transfers via FTP.

While the system administrator can establish secure permissions for users' `.netrc` files, the users can easily override these.

_Note: While the complete removal of `.netrc` files is recommended, if any are required on the system secure permissions must be applied._

## Rationale

The `.netrc` file presents a significant security risk since it stores passwords in unencrypted form. Even if FTP is disabled, user accounts may have brought over .netrc files from other systems which could pose a risk to those systems.

If a `.netrc` file is required, and follows local site policy, it should have permissions of `600` or more restrictive.

## Audit Procedure

### Command Line

Run the following script. This script will return:

- `FAILED:` for any `.netrc` file with permissions less restrictive than `600`
- `WARNING:` for any `.netrc` files that exist in interactive users' home directories.

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $1 " " $6 }' /etc/passwd | while
read -r user dir; do
  if [ -d "$dir" ]; then
    file="$dir/.netrc"
    if [ ! -h "$file" ] && [ -f "$file" ]; then
      if stat -L -c "%A" "$file" | cut -c4-10 | grep -Eq '[^-]+'; then
        echo "FAILED: User: \"$user\" file: \"$file\" exists with
permissions: \"$(stat -L -c "%a" "$file")\", remove file or excessive
permissions"
      else
        echo "WARNING: User: \"$user\" file: \"$file\" exists with
permissions: \"$(stat -L -c "%a" "$file")\", remove file unless required"
      fi
    fi
  fi
done
```

## Expected Result

- Any lines beginning with `FAILED:` - File should be removed unless deemed necessary, in accordance with local site policy, and permissions are updated to be `600` or more restrictive
- Any lines beginning with `WARNING:` - File should be removed unless deemed necessary, and in accordance with local site policy

## Remediation

### Command Line

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.netrc` file permissions and determine the action to be taken in accordance with site policy.

The following script will remove `.netrc` files from interactive users' home directories:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $6 }' /etc/passwd | while read
-r dir; do
  if [ -d "$dir" ]; then
    file="$dir/.netrc"
    [ ! -h "$file" ] && [ -f "$file" ] && rm -f "$file"
  fi
done
```

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |      |      |      |
