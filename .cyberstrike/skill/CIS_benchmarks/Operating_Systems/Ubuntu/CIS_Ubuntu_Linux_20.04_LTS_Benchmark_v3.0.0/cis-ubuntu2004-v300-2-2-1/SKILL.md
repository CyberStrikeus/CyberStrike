---
name: cis-ubuntu2004-v300-2-2-1
description: "Ensure NIS client is not installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.1 Ensure NIS client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network Information Service (NIS), formerly known as Yellow Pages, is a client-server directory service protocol used to distribute system configuration files. The NIS client was used to bind a machine to an NIS server and receive the distributed configuration files.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally has been replaced by LDAP based authentication. It is recommended that the NIS client be removed.

## Audit Procedure

### Command Line

Run the following command to verify nis is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' nis
```

Verify nis is not installed.

## Expected Result

nis package should not be installed.

## Remediation

### Command Line

Run the following command to remove nis:

```bash
# apt purge nis
```

## Default Value

nis is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7, CM-11

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 2.6 Address unapproved software                                                 |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1543, T1543.002 | TA0008 | M1042
