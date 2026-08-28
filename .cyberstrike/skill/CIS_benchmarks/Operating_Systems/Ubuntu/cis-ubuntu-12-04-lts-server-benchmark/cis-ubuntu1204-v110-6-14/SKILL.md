---
name: cis-ubuntu1204-v110-6-14
description: "Ensure SNMP Server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, snmp, snmpd, network-management, attack-surface]
cis_id: "6.14"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.14 Ensure SNMP Server is not enabled (Not Scored)

## Profile Applicability

- Level 1

## Description

The Simple Network Management Protocol (SNMP) server is used to listen for SNMP commands from an SNMP management system, execute the commands or collect the information and then send results back to the requesting system.

## Rationale

The SNMP server communicates using SNMP v1, which transmits data in the clear and does not require authentication to execute commands. Unless absolutely necessary, it is recommended that the SNMP service not be used.

## Audit Procedure

### Using Command Line

Run the following to ensure no start links for `snmpd` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*snmpd
```

## Expected Result

No results should be returned.

## Remediation

### Using Command Line

Remove any start links for `snmpd` from `/etc/rc*.d`:

```bash
rm /etc/rc*.d/S*snmpd
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
