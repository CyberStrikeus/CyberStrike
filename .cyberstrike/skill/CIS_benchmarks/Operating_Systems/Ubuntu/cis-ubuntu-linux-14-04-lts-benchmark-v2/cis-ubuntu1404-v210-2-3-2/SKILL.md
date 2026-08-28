---
name: "CIS Ubuntu 14.04 LTS - 2.3.2 Ensure rsh client is not installed"
description: "Verify that the rsh client package is not installed"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - service-clients
cis_id: "2.3.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 2.3.2 Ensure rsh client is not installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `rsh` package contains the client commands for the rsh services.

## Rationale

These legacy clients contain numerous security exposures and have been replaced with the more secure SSH package. Even if the server is removed, it is best to ensure the clients are also removed to prevent users from inadvertently attempting to use these commands and therefore exposing their credentials. Note that removing the `rsh` package removes the clients for `rsh`, `rcp` and `rlogin`.

## Audit Procedure

Run the following commands and verify `rsh` is not installed:

```bash
dpkg -s rsh-client
dpkg -s rsh-redone-client
```

## Expected Result

Both commands should indicate that the packages are not installed.

## Remediation

Run the following command to uninstall `rsh`:

```bash
apt-get remove rsh-client rsh-redone-client
```

## Default Value

rsh client is not installed by default.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## References

- CIS Controls: 3.4 Use Only Secure Channels For Remote System Administration

## Profile

- Level 1 - Server
- Level 1 - Workstation
