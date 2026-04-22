---
name: "CIS Ubuntu 14.04 LTS - 2.3.4 Ensure telnet client is not installed"
description: "Verify that the telnet client package is not installed"
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
cis_id: "2.3.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 2.3.4 Ensure telnet client is not installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `telnet` package contains the `telnet` client, which allows users to start connections to other systems via the `telnet` protocol.

## Rationale

The `telnet` protocol is insecure and unencrypted. The use of an unencrypted transmission medium could allow an unauthorized user to steal credentials. The `ssh` package provides an encrypted session and stronger security and is included in most Linux distributions.

## Audit Procedure

Run the following command and verify `telnet` is not installed:

```bash
dpkg -s telnet
```

## Expected Result

The command should indicate that the package is not installed (e.g., `dpkg-query: package 'telnet' is not installed`).

## Remediation

Run the following command to uninstall `telnet`:

```bash
apt-get remove telnet
```

## Default Value

telnet client may be installed by default.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## References

- CIS Controls: 3.4 Use Only Secure Channels For Remote System Administration

## Profile

- Level 1 - Server
- Level 1 - Workstation
