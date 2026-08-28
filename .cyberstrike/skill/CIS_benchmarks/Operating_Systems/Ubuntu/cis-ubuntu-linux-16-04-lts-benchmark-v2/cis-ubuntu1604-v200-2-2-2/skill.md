---
name: cis-ubuntu1604-v200-2-2-2
description: "Ensure rsh client is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.2 Ensure rsh client is not installed (Automated)

## Description

The rsh-client package contains the client commands for the rsh services.

## Rationale

These legacy clients contain numerous security exposures and have been replaced with the more secure SSH package. Even if the server is removed, it is best to ensure the clients are also removed to prevent users from inadvertently attempting to use these commands and therefore exposing their credentials. Note that removing the rsh package removes the clients for rsh, rcp and rlogin.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify rsh-client is not installed. Use the following command to provide the needed information:

```bash
dpkg -s rsh-client | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'rsh-client' is not installed and no information is available
```

## Remediation

### Command Line

Uninstall rsh:

```bash
apt purge rsh-client
```

## Default Value

rsh-client is not installed on minimal server installations.

## References

1. CIS Controls v7 - 4.5 Use Multifactor Authentication For All Administrative Access

## Profile

- Level 1 - Server
- Level 1 - Workstation
