---
name: "CIS Ubuntu 14.04 LTS - 1.7.1.2 Ensure local login warning banner is configured properly"
description: "Verify that /etc/issue local login banner does not contain OS version information"
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
cis_id: "1.7.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.7.1.2 Ensure local login warning banner is configured properly (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/issue` file are displayed to users prior to login for local terminals.

Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information: `\m` - machine architecture `\r` - operating system release `\s` - operating system name `\v` - operating system version

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure

Run the following command and verify that the contents match site policy:

```bash
cat /etc/issue
```

Run the following command and verify no results are returned:

```bash
egrep '(\\v|\\r|\\m|\\s)' /etc/issue
```

## Expected Result

The `/etc/issue` file should contain appropriate site policy text and should not contain `\m`, `\r`, `\s`, or `\v` escape sequences.

## Remediation

Edit the `/etc/issue` file with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, or `\v`:

```bash
echo "Authorized uses only. All activity may be monitored and reported." > /etc/issue
```

## Default Value

Not applicable.

## References

- CIS Controls: Warning banners section

## Profile

- Level 1 - Server
- Level 1 - Workstation
