---
name: cis-ubuntu1804-v220-2-2-3
description: "Ensure CUPS is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, cups]
cis_id: "2.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.3 Ensure CUPS is not installed (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

The Common Unix Print System (CUPS) provides the ability to print to both local and network printers. A system running CUPS can also accept print jobs from remote systems and print them to local printers. It also provides a web based remote administration capability.

## Rationale

If the system does not need to print jobs or accept print jobs from other systems, it is recommended that CUPS be removed to reduce the potential attack surface.

## Impact

Removing CUPS will prevent printing from the system, a common task for workstation systems.

## Audit Procedure

### Command Line

Run the following command to verify `cups` is not Installed:

```bash
# dpkg-query -s cups &>/dev/null && echo "cups is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Run one of the following commands to remove `cups`:

```bash
# apt purge cups
```

## References

1. More detailed documentation on CUPS is available at the project homepage at http://www.cups.org.
2. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
