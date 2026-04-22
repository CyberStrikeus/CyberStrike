---
name: cis-ubuntu1204-v110-6-3
description: "Ensure print server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, cups, print-server, attack-surface]
cis_id: "6.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3 Ensure print server is not enabled (Not Scored)

## Profile Applicability
- Level 1

## Description
The Common Unix Print System (CUPS) provides the ability to print to both local and network printers. A system running CUPS can also accept print jobs from remote systems and print them to local printers. It also provides a web based remote administration capability.

## Rationale
If the system does not need to print jobs or accept print jobs from other systems, it is recommended that CUPS be disabled to reduce the potential attack surface.

## Audit Procedure
### Using Command Line
Ensure no start conditions listed for `cups`:
```bash
initctl show-config cups cups
```

## Expected Result
No start conditions should be listed for cups.

## Remediation
### Using Command Line
Remove or comment out start lines in `/etc/init/cups.conf`:
```bash
sed -i 's/^start/#start/' /etc/init/cups.conf
```

## Default Value
Enabled by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- http://www.cups.org

## Profile
Level 1 - Not Scored
