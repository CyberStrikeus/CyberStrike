---
name: cis-ubuntu1204-v110-6-8
description: "Ensure DNS Server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, dns, bind9, attack-surface]
cis_id: "6.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.8 Ensure DNS Server is not enabled (Not Scored)

## Profile Applicability
- Level 1

## Description
The Domain Name System (DNS) is a hierarchical naming system that maps names to IP addresses for computers, services and other resources connected to a network.

## Rationale
Unless a server is specifically designated to act as a DNS server, it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure
### Using Command Line
Run the following to ensure no start links for `bind9` exist in `/etc/rc*.d`:
```bash
ls /etc/rc*.d/S*bind9
```

## Expected Result
No results should be returned.

## Remediation
### Using Command Line
Remove any start links for `bind9` from `/etc/rc*.d`:
```bash
rm /etc/rc*.d/S*bind9
```

## Default Value
Not installed by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
