---
name: "CIS Ubuntu 14.04 LTS - 1.7.1.6 Ensure permissions on /etc/issue.net are configured"
description: "Verify that /etc/issue.net has correct ownership and permissions to prevent unauthorized modification"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - banners
cis_id: "1.7.1.6"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.7.1.6 Ensure permissions on /etc/issue.net are configured (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/issue.net` file are displayed to users prior to login for remote connections from configured services.

## Rationale

If the `/etc/issue.net` file does not have the correct ownership it could be modified by unauthorized users with incorrect or misleading information.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`:

```bash
stat /etc/issue.net
```

## Expected Result

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

Run the following commands to set permissions on `/etc/issue.net`:

```bash
chown root:root /etc/issue.net
chmod 644 /etc/issue.net
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

- CIS Controls: 5.1 Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
