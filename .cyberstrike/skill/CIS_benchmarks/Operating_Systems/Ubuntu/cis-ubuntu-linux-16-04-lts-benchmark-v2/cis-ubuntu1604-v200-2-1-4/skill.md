---
name: cis-ubuntu1604-v200-2-1-4
description: "Ensure CUPS is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4 Ensure CUPS is not installed (Automated)

## Description

The Common Unix Print System (CUPS) provides the ability to print to both local and network printers. A system running CUPS can also accept print jobs from remote systems and print them to local printers. It also provides a web based remote administration capability.

## Rationale

If the system does not need to print jobs or accept print jobs from other systems, it is recommended that CUPS be removed to reduce the potential attack surface.

## Impact

Removing CUPS will prevent printing from the system, a common task for workstation systems.

## Audit Procedure

### Command Line

Run the following command to verify cups is not installed:

```bash
dpkg -s cups | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'cups' is not installed and no information is available
```

## Remediation

### Command Line

Run one of the following commands to remove cups:

```bash
apt purge cups
```

## Default Value

cups is not installed on minimal server installations.

## References

1. More detailed documentation on CUPS is available at the project homepage at http://www.cups.org.
2. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 2 - Workstation
