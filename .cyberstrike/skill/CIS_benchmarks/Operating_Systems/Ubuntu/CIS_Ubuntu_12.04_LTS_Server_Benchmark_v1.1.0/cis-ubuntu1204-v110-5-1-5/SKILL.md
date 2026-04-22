---
name: cis-ubuntu1204-v110-5-1-5
description: "Ensure talk client is not installed"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, talk, legacy-services, package-management]
cis_id: "5.1.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.5 Ensure talk client is not installed (Scored)

## Profile Applicability
- Level 1

## Description
The `talk` software makes it possible for users to send and receive messages across systems through a terminal session. The `talk` client (allows initialization of talk sessions) is installed by default.

## Rationale
The software presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure
### Using Command Line
Run the following command:
```bash
dpkg -s talk
```

## Expected Result
Ensure package status is not-installed or dpkg returns no info is available.

## Remediation
### Using Command Line
Uninstall the `talk` package:
```bash
apt-get purge talk
```

## Default Value
Installed by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
