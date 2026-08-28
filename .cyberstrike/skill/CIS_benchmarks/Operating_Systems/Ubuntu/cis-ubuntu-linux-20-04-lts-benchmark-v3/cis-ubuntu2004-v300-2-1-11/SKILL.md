---
name: cis-ubuntu2004-v300-2-1-11
description: "Ensure print server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.11"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.11 Ensure print server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

The Common Unix Print System (CUPS) provides the ability to print to both local and network printers. A system running CUPS can also accept print jobs from remote systems and print them to local printers. It also provides a web based remote administration capability.

## Rationale

If the system does not need to print jobs or accept print jobs from other systems, it is recommended that CUPS be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify cups is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' cups
```

If installed, run:

```bash
# systemctl is-enabled cups.socket cups.service
# systemctl is-active cups.socket cups.service
```

Verify the services are not enabled and not active.

## Expected Result

cups should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge cups:

```bash
# systemctl stop cups.socket cups.service
# systemctl mask cups.socket cups.service
# apt purge cups
```

## Default Value

cups is installed by default on desktop installations.

## References

1. http://www.cups.org
2. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
