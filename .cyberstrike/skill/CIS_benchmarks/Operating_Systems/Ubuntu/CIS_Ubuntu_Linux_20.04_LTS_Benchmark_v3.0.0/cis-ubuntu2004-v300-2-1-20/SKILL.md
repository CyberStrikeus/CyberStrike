---
name: cis-ubuntu2004-v300-2-1-20
description: "Ensure X window server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.20"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.20 Ensure X window server services are not in use (Automated)

## Profile

- Level 2 - Server

## Description

The X Window System provides a Graphical User Interface (GUI) where users can have multiple windows in which to run programs and various add on. The X Windows system is typically used on workstations where users login, but not on servers where users typically do not login.

## Rationale

Unless your organization specifically requires graphical login access via X Windows, remove it to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify xserver-common is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' xserver-common
```

Verify xserver-common is not installed.

## Expected Result

xserver-common should not be installed on server systems.

## Remediation

### Command Line

Run the following command to remove xserver-common:

```bash
# apt purge xserver-common
```

## Default Value

xserver-common is installed on desktop installations, not on server installations.

## References

1. NIST SP 800-53 Rev. 5: CM-11

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 2.6 Address unapproved software | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
