---
name: cis-ubuntu1604-v200-2-1-14
description: "Ensure SNMP Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.14"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.14 Ensure SNMP Server is not installed (Automated)

## Description

Simple Network Management Protocol (SNMP) is a widely used protocol for monitoring the health and welfare of network equipment, computer equipment and devices like UPSs.

Net-SNMP is a suite of applications used to implement SNMPv1 (RFC 1157), SNMPv2 (RFCs 1901-1908), and SNMPv3 (RFCs 3411-3418) using both IPv4 and IPv6.

Support for SNMPv2 classic (a.k.a. "SNMPv2 historic" - RFCs 1441-1452) was dropped with the 4.0 release of the UCD-snmp package.

The Simple Network Management Protocol (SNMP) server is used to listen for SNMP commands from an SNMP management system, execute the commands or collect the information and then send results back to the requesting system.

## Rationale

The SNMP server can communicate using SNMPv1, which transmits data in the clear and does not require authentication to execute commands. SNMPv3 replaces the simple/clear text password sharing used in SNMPv2 with more securely encoded parameters. If the the SNMP service is not required, the net-snmp package should be removed to reduce the attack surface of the system.

Note: If SNMP is required:

- The server should be configured for SNMP v3 only. User Authentication and Message Encryption should be configured.
- If SNMP v2 is **absolutely** necessary, modify the community strings' values.

## Audit Procedure

### Command Line

Run the following command to verify snmpd is not installed:

```bash
dpkg -s snmpd | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'snmpd' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove snmpd:

```bash
apt purge snmpd
```

## Default Value

snmpd is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
