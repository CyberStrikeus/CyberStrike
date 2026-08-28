---
name: "CIS Ubuntu 14.04 LTS - 5.4.5 Ensure default user shell timeout is 900 seconds or less"
description: "Verify TMOUT is set to 900 seconds or less in shell configuration files for idle session timeout"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - user-accounts
cis_id: "5.4.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 5.4.5 Ensure default user shell timeout is 900 seconds or less (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The default `TMOUT` determines the shell timeout for users. The TMOUT value is measured in seconds.

## Rationale

Having no timeout value associated with a shell could allow an unauthorized user access to another user's shell session (e.g. user walks away from their computer and doesn't lock the screen). Setting a timeout value at least reduces the risk of this happening.

## Audit Procedure

Run the following commands and verify all TMOUT lines returned are 900 or less and at least one exists in each file:

```bash
grep "^TMOUT" /etc/bashrc
grep "^TMOUT" /etc/profile
```

## Expected Result

```
TMOUT=600
```

## Remediation

Edit the `/etc/bashrc` and `/etc/profile` files (and the appropriate files for any other shell supported on your system) and add or edit any umask parameters as follows:

```
TMOUT=600
```

## Default Value

No TMOUT configured by default.

## References

- CIS Controls: 16.4 - Automatically Log Off Users After Standard Period Of Inactivity

## Profile

- Level 2 - Server
- Level 2 - Workstation
