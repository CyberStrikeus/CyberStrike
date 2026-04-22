---
name: "CIS Ubuntu 14.04 LTS - 3.4.1 Ensure TCP Wrappers is installed"
description: "Verify that TCP Wrappers is installed for host-based access control"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - tcp-wrappers
  - network
cis_id: "3.4.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.4.1 Ensure TCP Wrappers is installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

TCP Wrappers provides a simple access list and standardized logging method for services capable of supporting it. In the past, services that were called from `inetd` and `xinetd` supported the use of tcp wrappers. As `inetd` and `xinetd` have been falling in disuse, any service that can support tcp wrappers will have the `libwrap.so` library attached to it.

## Rationale

TCP Wrappers provide a good simple access list mechanism to services that may not have that support built in. It is recommended that all services that can support TCP Wrappers, use it.

## Audit Procedure

Run the following command and verify TCP Wrappers is installed:

```bash
dpkg -s tcpd
```

## Expected Result

The package `tcpd` should be installed (status: install ok installed).

## Remediation

Run the following command to install TCP Wrappers:

```bash
apt-get install tcpd
```

## Default Value

Not installed by default on all systems.

## References

- CIS Controls: 9.2 - Leverage Host-based Firewalls

## Profile

- Level 1 - Server
- Level 1 - Workstation
