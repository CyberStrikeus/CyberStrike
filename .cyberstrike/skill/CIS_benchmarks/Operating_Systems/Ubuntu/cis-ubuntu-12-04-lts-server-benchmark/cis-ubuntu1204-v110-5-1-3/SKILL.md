---
name: cis-ubuntu1204-v110-5-1-3
description: "Ensure rsh client is not installed"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, rsh, legacy-services, package-management]
cis_id: "5.1.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Ensure rsh client is not installed (Scored)

## Profile Applicability

- Level 1

## Description

The `rsh` package contains the client commands for the rsh services.

## Rationale

These legacy clients contain numerous security exposures and have been replaced with the more secure SSH package. Even if the server is removed, it is best to ensure the clients are also removed to prevent users from inadvertently attempting to use these commands and therefore exposing their credentials. Note that removing the `rsh` package removes the clients for `rsh`, `rcp` and `rlogin`.

## Audit Procedure

### Using Command Line

Run the following commands:

```bash
dpkg -s rsh-client
dpkg -s rsh-redone-client
```

## Expected Result

Ensure package status is not-installed or dpkg returns no info is available for both.

## Remediation

### Using Command Line

Uninstall the `rsh-client` and `rsh-reload-client` packages:

```bash
apt-get purge rsh-client rsh-reload-client
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
