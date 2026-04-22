---
name: cis-ubuntu2004-v300-2-2-3
description: "Ensure talk client is not installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.3 Ensure talk client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The talk software makes it possible for users to send and receive messages across systems through a terminal session. The talk client, which allows initialization of talk sessions, is installed by the talk package.

## Rationale

The software presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure

### Command Line

Run the following command to verify talk is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' talk
```

Verify talk is not installed.

## Expected Result

talk package should not be installed.

## Remediation

### Command Line

Run the following command to remove talk:

```bash
# apt purge talk
```

## Default Value

talk is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1543, T1543.002 | TA0006, TA0008 | M1041, M1042
