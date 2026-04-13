---
name: cis-gcp-cos-5.3.5
description: "Ensure default user shell timeout is 900 seconds or less"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, user-accounts, shell-timeout]
cis_id: "5.3.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.5 Ensure default user shell timeout is 900 seconds or less (Automated)

## Description

The default `TMOUT` determines the shell timeout for users. The TMOUT value is measured in seconds.

## Rationale

Having no timeout value associated with a shell could allow an unauthorized user access to another user's shell session (e.g. user walks away from their computer and doesn't lock the screen). Setting a timeout value at least reduces the risk of this happening.

## Audit Procedure

Run the following commands and verify all TMOUT lines returned are 900 or less and at least one exists in each file.

```bash
# grep "^TMOUT" /etc/bash/bashrc
TMOUT=900

# grep "^TMOUT" /etc/profile
TMOUT=900
```

## Expected Result

`TMOUT` should be set to 900 or less in both `/etc/bash/bashrc` and `/etc/profile`.

## Remediation

Edit the `/etc/bash/bashrc` and `/etc/profile` files (and the appropriate files for any other shell supported on your system) and add or edit any umask parameters as follows:

```
TMOUT=900
```

Additional Information:

The audit and remediation in this recommendation apply to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked. Other methods of setting a timeout exist for other shells not covered here.

Ensure that the timeout conforms to your local policy.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **4.3 Configure Automatic Session Locking on Enterprise Assets** - Configure automatic session locking on enterprise assets after a defined period of inactivity. For general purpose operating systems, the period must not exceed 15 minutes. For mobile end-user devices, the period must not exceed 2 minutes. | x | x | x |
| v7 | **16.11 Lock Workstation Sessions After Inactivity** - Automatically lock workstation sessions after a standard period of inactivity. | x | x | x |

## Profile

- Level 2 - Server
