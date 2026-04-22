---
name: "CIS Ubuntu 14.04 LTS - 2.1.10 Ensure xinetd is not enabled"
description: "Verify that the xinetd super daemon is disabled when not required"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - inetd
cis_id: "2.1.10"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.1.10 Ensure xinetd is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The eXtended InterNET Daemon (`xinetd`) is an open source super daemon that replaced the original `inetd` daemon. The `xinetd` daemon listens for well known services and dispatches the appropriate daemon to properly respond to service requests.

## Rationale

If there are no `xinetd` services required, it is recommended that the daemon be disabled.

## Audit Procedure

Run the following commands to verify no start conditions listed for `xinetd`:

```bash
initctl show-config xinetd
```

Verify the output shows `xinetd` with no start conditions.

## Expected Result

The `xinetd` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/xinetd.conf`:

```bash
#start on runlevel [2345]
```

## Default Value

xinetd is not enabled by default on Ubuntu 14.04.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
