---
name: cis-ubuntu2004-v300-4-3-4
description: "Ensure a nftables table exists"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.4

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Tables hold chains. Each table only has one address family and only applies to packets of this family. Tables can have one of five families.

## Rationale

nftables doesn't have any default tables. Without a table being built, nftables will not filter network traffic.

## Impact

Adding rules to a running nftables can cause loss of connectivity to the system

## Audit Procedure

### Command Line

Run the following command to verify that a nftables table exists:

```bash
nft list tables
```

Return should include a list of nftables:
Example:

```
table inet filter
```

## Expected Result

A list of nftables tables is returned (e.g., `table inet filter`).

## Remediation

### Command Line

Run the following command to create a table in nftables

```bash
nft create table inet <table name>
```

Example:

```bash
nft create table inet filter
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1047
