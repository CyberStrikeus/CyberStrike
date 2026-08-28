---
name: cis-ubuntu1204-v110-13-20
description: "Check for Presence of User .forward Files"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, forward, email, mail-forwarding]
cis_id: "13.20"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.20 Check for Presence of User .forward Files (Scored)

## Profile Applicability

- Level 1

## Description

The `.forward` file specifies an email address to forward the user's mail to.

## Rationale

Use of the `.forward` file poses a security risk in that sensitive data may be inadvertently transferred outside the organization. The `.forward` file also poses a risk as it can be used to execute commands that may perform unintended actions.

## Audit Procedure

### Using Command Line

This script checks for the presence of `.forward` files that may be in violation of the site security policy.

```bash
#!/bin/bash
for dir in `/bin/cat /etc/passwd |\
/usr/bin/awk -F: '{ print $6 }'`; do
    if [ ! -h "$dir/.forward" -a -f "$dir/.forward" ]; then
echo ".forward file $dir/.forward exists"
    fi
done
```

## Expected Result

No output should be returned. Any output indicates the presence of `.forward` files in user home directories.

## Remediation

### Using Command Line

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.forward` files and determine the action to be taken in accordance with site policy.

## Default Value

No `.forward` files exist by default on Ubuntu 12.04.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
