---
name: cis-ubuntu2004-v300-2-2-2
description: "Ensure rsh client is not installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.2 Ensure rsh client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The rsh-client package contains the client commands for the rsh services.

## Rationale

These legacy clients contain numerous security exposures and have been replaced with the more secure SSH package. Even if the server is removed, it is best to ensure the clients are also removed to prevent users from inadvertently attempting to use these commands and therefore exposing their credentials. Note that removing the rsh package removes the clients for rsh, rcp and rlogin.

## Audit Procedure

### Command Line

Run the following command to verify rsh-client is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' rsh-client
```

Verify rsh-client is not installed.

## Expected Result

rsh-client package should not be installed.

## Remediation

### Command Line

Run the following command to remove rsh-client:

```bash
# apt purge rsh-client
```

## Default Value

rsh-client is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1040, T1203, T1543, T1543.002 | TA0008 | M1041, M1042
