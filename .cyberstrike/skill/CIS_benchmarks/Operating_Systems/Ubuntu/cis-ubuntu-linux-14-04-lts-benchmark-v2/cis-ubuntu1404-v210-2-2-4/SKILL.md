---
name: "CIS Ubuntu 14.04 LTS - 2.2.4 Ensure CUPS is not enabled"
description: "Verify that CUPS print service is disabled when not required"
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
cis_id: "2.2.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 2.2.4 Ensure CUPS is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 2 - Workstation

## Description

The Common Unix Print System (CUPS) provides the ability to print to both local and network printers. A system running CUPS can also accept print jobs from remote systems and print them to local printers. It also provides a web based remote administration capability.

## Rationale

If the system does not need to print jobs or accept print jobs from other systems, it is recommended that CUPS be disabled to reduce the potential attack surface.

## Audit Procedure

Run the following commands to verify no start conditions listed for `cups`:

```bash
initctl show-config cups
```

Verify the output shows `cups` with no start conditions.

## Expected Result

The `cups` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/cups.conf`:

```bash
#start on runlevel [2345]
```

## Default Value

CUPS may be enabled by default on workstation installations. Disabling CUPS will prevent printing from the system, a common task for workstation systems.

## References

1. More detailed documentation on CUPS is available at the project homepage at http://www.cups.org.

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 2 - Workstation
