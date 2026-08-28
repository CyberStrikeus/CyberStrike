---
name: "CIS Ubuntu 14.04 LTS - 2.2.13 Ensure HTTP Proxy Server is not enabled"
description: "Verify that Squid HTTP proxy server is disabled when not required"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.13"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.13 Ensure HTTP Proxy Server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Squid is a standard proxy server used in many distributions and environments.

## Rationale

If there is no need for a proxy server, it is recommended that the squid proxy be deleted to reduce the potential attack surface.

## Audit Procedure

Ensure no start conditions listed for `squid3`:

```bash
initctl show-config squid3
```

Verify the output shows `squid3` with no start conditions.

## Expected Result

The `squid3` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/squid3.conf`:

```bash
#start on runlevel [2345]
```

## Default Value

Squid proxy server is not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
