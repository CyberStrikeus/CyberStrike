---
name: "CIS Ubuntu 14.04 LTS - 2.3.3 Ensure talk client is not installed"
description: "Verify that the talk client package is not installed"
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
cis_id: "2.3.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 2.3.3 Ensure talk client is not installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `talk` software makes it possible for users to send and receive messages across systems through a terminal session. The `talk` client, which allows initialization of talk sessions, is installed by default.

## Rationale

The software presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure

Run the following command and verify `talk` is not installed:

```bash
dpkg -s talk
```

## Expected Result

The command should indicate that the package is not installed (e.g., `dpkg-query: package 'talk' is not installed`).

## Remediation

Run the following command to uninstall `talk`:

```bash
apt-get remove talk
```

## Default Value

talk may be installed by default.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## References

- CIS Controls: 2 Inventory of Authorized and Unauthorized Software

## Profile

- Level 1 - Server
- Level 1 - Workstation
