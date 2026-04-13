---
name: cis-gcp-cos-1.5.1.3
description: "Ensure remote login warning banner is configured properly"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, banners, login-banner, remote-login, information-disclosure]
cis_id: "1.5.1.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.1.3 Ensure remote login warning banner is configured properly (Automated)

## Description

The contents of the `/etc/issue.net` file are displayed to users prior to login for remote connections from configured services.

Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information: `\m` - machine architecture `\r` - operating system release `\s` - operating system name `\v` - operating system version

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure

Run the following command and verify that the contents match site policy:

```bash
# cat /etc/issue.net
```

Run the following command and verify no results are returned:

```bash
# grep -E -i "(\\v|\\r|\\m|\\s|$(grep '^ID=' /etc/os-release | cut -d= -f2 | sed -e 's/"//g'))" /etc/issue.net
```

## Expected Result

The `/etc/issue.net` file should contain the appropriate site policy message. The grep command should return no results (no OS information leakage).

## Remediation

Edit the `/etc/issue.net` file with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, `\v` or references to the `OS platform`.

```bash
# echo "Authorized uses only. All activity may be monitored and reported." > /etc/issue.net
```

`/etc` is stateless on Container-Optimized OS. Therefore, the steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations | x    | x    | x    |

## Profile

Level 1 - Server | Automated
