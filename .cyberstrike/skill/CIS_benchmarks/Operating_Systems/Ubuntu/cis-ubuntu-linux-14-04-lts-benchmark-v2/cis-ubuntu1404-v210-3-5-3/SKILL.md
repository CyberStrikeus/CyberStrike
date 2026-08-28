---
name: "CIS Ubuntu 14.04 LTS - 3.5.3 Ensure RDS is disabled"
description: "Verify that the RDS protocol kernel module is disabled to reduce attack surface"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - network
cis_id: "3.5.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 3.5.3 Ensure RDS is disabled (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Reliable Datagram Sockets (RDS) protocol is a transport layer protocol designed to provide low-latency, high-bandwidth communications between cluster nodes. It was developed by the Oracle Corporation.

## Rationale

If the protocol is not being used, it is recommended that kernel module not be loaded, disabling the service to reduce the potential attack surface.

## Audit Procedure

Run the following commands and verify the output is as indicated:

```bash
modprobe -n -v rds
# Expected: install /bin/true

lsmod | grep rds
# Expected: <No output>
```

## Expected Result

```
install /bin/true
```

And no output from `lsmod | grep rds`.

## Remediation

Edit or create the file `/etc/modprobe.d/CIS.conf` and add the following line:

```
install rds /bin/true
```

## Default Value

Not disabled by default.

## References

- CIS Controls: 9.1 - Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
