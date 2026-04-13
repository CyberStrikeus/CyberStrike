---
name: cis-gcp-cos-6.2.12
description: "Ensure no users have .netrc files"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, netrc]
cis_id: "6.2.12"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.12 Ensure no users have .netrc files (Automated)

## Description

The `.netrc` file contains data for logging into a remote host for file transfers via FTP.

## Rationale

The `.netrc` file presents a significant security risk since it stores passwords in unencrypted form. Even if FTP is disabled, user accounts may have brought over `.netrc` files from other systems which could pose a risk to those systems.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

grep -E -v '^(root|halt|sync|shutdown)' /etc/passwd | awk -F: '($7 != "'"$(which nologin)"'" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
    echo "The home directory ($dir) of user $user does not exist."
  else
    if [ ! -h "$dir/.netrc" -a -f "$dir/.netrc" ]; then
      echo ".netrc file $dir/.netrc exists"
    fi
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.netrc` files and determine the action to be taken in accordance with site policy.

## Additional Information

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest                 |      | x    | x    |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials |      | x    | x    |

## Profile

- Level 2 - Server
