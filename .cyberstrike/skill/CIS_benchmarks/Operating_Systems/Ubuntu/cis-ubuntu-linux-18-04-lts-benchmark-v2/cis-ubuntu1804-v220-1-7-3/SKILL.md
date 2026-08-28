---
name: cis-ubuntu1804-v220-1-7-3
description: "Ensure remote login warning banner is configured properly"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, login-banner, warning-banners, issue-net, remote]
cis_id: "1.7.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.3 Ensure remote login warning banner is configured properly (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/issue.net` file are displayed to users prior to login for remote connections from configured services.

Unix-based systems have typically displayed information about the OS release and patch level upon logging in to the system. This information can be useful to developers who are developing software for a particular OS platform. If `mingetty(8)` supports the following options, they display operating system information: `\m` - machine architecture `\r` - operating system release `\s` - operating system name `\v` - operating system version

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Displaying OS and patch level information in login banners also has the side effect of providing detailed system information to attackers attempting to target specific exploits of a system. Authorized users can easily get this information by running the `uname -a` command once they have logged in.

## Audit Procedure

### Command Line

Run the following command and verify that the contents match site policy:

```bash
cat /etc/issue.net
```

Run the following command and verify no results are returned:

```bash
grep -E -i "(\\v|\\r|\\m|\\s|$(grep '^ID=' /etc/os-release | cut -d= -f2 | sed -e 's/"//g'))" /etc/issue.net
```

## Expected Result

Nothing should be returned from the grep command.

## Remediation

### Command Line

Edit the `/etc/issue.net` file with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, `\v` or references to the `OS platform`. Add or update the message text to follow local site policy.

Example Text:

```bash
echo "Authorized use only. All activity may be monitored and reported." > /etc/issue.net
```

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-1, CM-3

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques                          | Tactics | Mitigations |
| ---------------------------------------------------- | ------- | ----------- |
| T1018, T1018.000, T1082, T1082.000, T1592, T1592.004 | TA0007  |             |
