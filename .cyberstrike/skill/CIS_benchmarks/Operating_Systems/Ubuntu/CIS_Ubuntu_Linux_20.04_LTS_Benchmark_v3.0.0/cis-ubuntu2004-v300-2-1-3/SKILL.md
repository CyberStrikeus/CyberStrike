---
name: cis-ubuntu2004-v300-2-1-3
description: "Ensure dhcp server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.3 Ensure dhcp server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Dynamic Host Configuration Protocol (DHCP) is a service that allows machines to be automatically assigned IP addresses, reducing the administration burden of manually assigning IP addresses to all devices on a network.

## Rationale

Unless a system is specifically set up to act as a DHCP server, it is recommended that the dhcp server service be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify isc-dhcp-server is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' isc-dhcp-server
```

If installed, run:

```bash
# systemctl is-enabled isc-dhcp-server.service isc-dhcp-server6.service
# systemctl is-active isc-dhcp-server.service isc-dhcp-server6.service
```

Verify the services are not enabled and not active.

## Expected Result

isc-dhcp-server should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge isc-dhcp-server:

```bash
# systemctl stop isc-dhcp-server.service isc-dhcp-server6.service
# systemctl mask isc-dhcp-server.service isc-dhcp-server6.service
# apt purge isc-dhcp-server
```

## Default Value

isc-dhcp-server is not installed by default.

## References

1. http://www.isc.org/software/dhcp
2. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
