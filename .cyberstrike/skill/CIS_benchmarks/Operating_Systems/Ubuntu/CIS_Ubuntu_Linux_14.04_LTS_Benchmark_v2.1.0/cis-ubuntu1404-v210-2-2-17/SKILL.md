---
name: "CIS Ubuntu 14.04 LTS - 2.2.17 Ensure NIS Server is not enabled"
description: "Verify that NIS (ypserv) server is disabled when not required"
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
cis_id: "2.2.17"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.17 Ensure NIS Server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network Information Service (NIS) (formally known as Yellow Pages) is a client-server directory service protocol for distributing system configuration files. The NIS server is a collection of programs that allow for the distribution of configuration files.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally been replaced by such protocols as Lightweight Directory Access Protocol (LDAP). It is recommended that the service be disabled and other, more secure services be used.

## Audit Procedure

Run the following commands to verify no start conditions listed for `ypserv`:

```bash
initctl show-config ypserv
```

Verify the output shows `ypserv` with no start conditions.

## Expected Result

The `ypserv` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/ypserv.conf`:

```bash
#start on (started portmap ON_BOOT=
#         or (started portmap ON_BOOT=y
#              and ((filesystem and static-network-up) or failsafe-boot)))
```

## Default Value

NIS server is not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
