---
name: cis-ubuntu1604-v200-2-2-3
description: "Ensure talk client is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.3 Ensure talk client is not installed (Automated)

## Description

The talk software makes it possible for users to send and receive messages across systems through a terminal session. The talk client, which allows initialization of talk sessions, is installed by default.

## Rationale

The software presents a security risk as it uses unencrypted protocols for communication.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify talk is not installed. The following command may provide the needed information:

```bash
dpkg -s talk | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'talk' is not installed and no information is available
```

## Remediation

### Command Line

Uninstall talk:

```bash
apt purge talk
```

## Default Value

talk is not installed on minimal server installations.

## References

1. CIS Controls v7 - 2.6 Address unapproved software

## Profile

- Level 1 - Server
- Level 1 - Workstation
