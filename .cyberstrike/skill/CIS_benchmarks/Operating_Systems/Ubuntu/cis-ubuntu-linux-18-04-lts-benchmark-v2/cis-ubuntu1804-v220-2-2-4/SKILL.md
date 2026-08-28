---
name: cis-ubuntu1804-v220-2-2-4
description: "Ensure DHCP Server is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, dhcp]
cis_id: "2.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.4 Ensure DHCP Server is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Dynamic Host Configuration Protocol (DHCP) is a service that allows machines to be dynamically assigned IP addresses.

## Rationale

Unless a system is specifically set up to act as a DHCP server, it is recommended that this package be removed to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following commands to verify `isc-dhcp-server` is not installed:

```bash
# dpkg-query -s isc-dhcp-server &>/dev/null && echo "isc-dhcp-server is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Run the following command to remove `isc-dhcp-server`:

```bash
# apt purge isc-dhcp-server
```

## References

1. More detailed documentation on DHCP is available at http://www.isc.org/software/dhcp.
2. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
