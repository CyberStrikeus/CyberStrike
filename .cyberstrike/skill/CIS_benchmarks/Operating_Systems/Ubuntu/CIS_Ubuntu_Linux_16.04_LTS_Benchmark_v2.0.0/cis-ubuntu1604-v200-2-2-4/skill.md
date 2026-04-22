---
name: cis-ubuntu1604-v200-2-2-4
description: "Ensure telnet client is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.4 Ensure telnet client is not installed (Automated)

## Description

The telnet package contains the telnet client, which allows users to start connections to other systems via the telnet protocol.

## Rationale

The telnet protocol is insecure and unencrypted. The use of an unencrypted transmission medium could allow an unauthorized user to steal credentials. The ssh package provides an encrypted session and stronger security and is included in most Linux distributions.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify telnet is not installed. Use the following command to provide the needed information:

```bash
dpkg -s telnet | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'telnet' is not installed and no information is available
```

## Remediation

### Command Line

Uninstall telnet:

```bash
apt purge telnet
```

## Default Value

telnet is not installed on minimal server installations.

## References

1. CIS Controls v7 - 4.5 Use Multifactor Authentication For All Administrative Access

## Profile

- Level 1 - Server
- Level 1 - Workstation
