---
name: cis-ubuntu1204-v110-11-2
description: "Remove OS Information from Login Warning Banners"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, banner, os-info, information-disclosure]
cis_id: "11.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.2 Remove OS Information from Login Warning Banners (Scored)

## Profile Applicability
- Level 1

## Description
Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information:
- `\m` - machine architecture (`uname -m`)
- `\r` - operating system release (`uname -r`)
- `\s` - operating system name
- `\v` - operating system version (`uname -v`)

## Rationale
Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure
### Using Command Line
Perform the following commands to check if OS information is set to be displayed in the system login banners:
```bash
egrep '(\\v|\\r|\\m|\\s)' /etc/issue
egrep '(\\v|\\r|\\m|\\s)' /etc/motd
egrep '(\\v|\\r|\\m|\\s)' /etc/issue.net
```

## Expected Result
No output should be returned from any of the commands, indicating that no OS information escape sequences are present in the banner files.

## Remediation
### Using Command Line
Edit the `/etc/motd`, `/etc/issue` and `/etc/issue.net` files and remove any lines containing `\m`, `\r`, `\s` or `\v`.

## Default Value
The default Ubuntu banner files may contain OS information escape sequences.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
