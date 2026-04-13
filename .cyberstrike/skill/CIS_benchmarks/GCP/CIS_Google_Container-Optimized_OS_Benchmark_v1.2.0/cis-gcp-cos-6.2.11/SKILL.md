---
name: cis-gcp-cos-6.2.11
description: "Ensure no users have .forward files"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, forward-files]
cis_id: "6.2.11"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.11 Ensure no users have .forward files (Automated)

## Description

The `.forward` file specifies an email address to forward the user's mail to.

## Rationale

Use of the `.forward` file poses a security risk in that sensitive data may be inadvertently transferred outside the organization. The `.forward` file also poses a risk as it can be used to execute commands that may perform unintended actions.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

grep -E -v '^(root|halt|sync|shutdown)' /etc/passwd | awk -F: '($7 != "'"$(which nologin)"'" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
    echo "The home directory ($dir) of user $user does not exist."
  else
    if [ ! -h "$dir/.forward" -a -f "$dir/.forward" ]; then
      echo ".forward file $dir/.forward exists"
    fi
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.forward` files and determine the action to be taken in accordance with site policy.

## Additional Information

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

- Level 2 - Server
