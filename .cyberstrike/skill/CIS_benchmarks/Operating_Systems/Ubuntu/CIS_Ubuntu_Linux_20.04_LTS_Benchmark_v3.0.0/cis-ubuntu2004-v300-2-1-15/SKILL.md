---
name: cis-ubuntu2004-v300-2-1-15
description: "Ensure snmp services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.15"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.15 Ensure snmp services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Simple Network Management Protocol (SNMP) is a widely used protocol for monitoring the health and welfare of network equipment, computer equipment and devices like UPSs. Net-SNMP is a suite of applications used to implement SNMPv1 (RFC 1157), SNMPv2 (RFCs 1901-1908), and SNMPv3 (RFCs 3411-3418) using both IPv4 and IPv6.

## Rationale

The SNMP server can communicate using SNMPv1, which transmits data in the clear and does not require authentication to execute commands. Unless absolutely necessary, it is recommended that the SNMP service not be used. If SNMP is required, the server should be configured to disallow SNMPv1.

## Audit Procedure

### Command Line

Run the following command to verify snmpd is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' snmpd
```

If installed, run:

```bash
# systemctl is-enabled snmpd.service
# systemctl is-active snmpd.service
```

Verify the service is not enabled and not active.

## Expected Result

snmpd should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge snmpd:

```bash
# systemctl stop snmpd.service
# systemctl mask snmpd.service
# apt purge snmpd
```

## Default Value

snmpd is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
