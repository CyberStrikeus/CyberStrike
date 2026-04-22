---
name: "CIS Ubuntu 14.04 LTS - 2.2.5 Ensure DHCP Server is not enabled"
description: "Verify that DHCP server service is disabled when not required"
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
cis_id: "2.2.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.5 Ensure DHCP Server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Dynamic Host Configuration Protocol (DHCP) is a service that allows machines to be dynamically assigned IP addresses.

## Rationale

Unless a system is specifically set up to act as a DHCP server, it is recommended that this service be deleted to reduce the potential attack surface.

## Audit Procedure

Ensure no start conditions listed for `isc-dhcp-server` or `isc-dhcp-server6`:

```bash
initctl show-config isc-dhcp-server
initctl show-config isc-dhcp-server6
```

Verify the output shows no start conditions.

## Expected Result

The `isc-dhcp-server` and `isc-dhcp-server6` services should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/isc-dhcp-server.conf` and `/etc/init/isc-dhcp-server6.conf`:

```bash
#start on runlevel [2345]
```

## Default Value

DHCP server is not enabled by default.

## References

1. More detailed documentation on DHCP is available at http://www.isc.org/software/dhcp.

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
