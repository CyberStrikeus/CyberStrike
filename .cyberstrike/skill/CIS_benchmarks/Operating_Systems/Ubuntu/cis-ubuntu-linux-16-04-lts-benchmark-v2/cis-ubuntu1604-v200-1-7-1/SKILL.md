---
name: cis-ubuntu1604-v200-1-7-1
description: "Ensure message of the day is configured properly"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, motd, banner, warning, login]
cis_id: "1.7.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.7.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/motd` file are displayed to users after login and function as a message of the day for authenticated users.

Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information: `\m` - machine architecture `\r` - operating system release `\s` - operating system name `\v` - operating system version

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure

### Command Line

Run the following command and verify no results are returned:

```bash
grep -Eis "(\\v|\\r|\\m|\\s|$(grep '^ID=' /etc/os-release | cut -d= -f2 | sed -e 's/"//g'))" /etc/motd
```

## Expected Result

No output should be returned, indicating the motd does not contain OS information references.

## Remediation

### Command Line

Edit the `/etc/motd` file with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, `\v` or references to the OS platform.

**OR** if the motd is not used, this file can be removed. Run the following command to remove the motd file:

```bash
rm /etc/motd
```

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control                             |
| ---------------- | ----------------------------------- |
| v7               | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
