---
name: cis-ubuntu1604-v200-3-5-2-4
description: "Ensure a nftables table exists"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.4

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Tables hold chains. Each table only has one address family and only applies to packets of this family. Tables can have one of five families.

## Rationale

nftables doesn't have any default tables. Without a table being build, nftables will not filter network traffic.

## Impact

Adding rules to a running nftables can cause loss of connectivity to the system.

## Audit Procedure

### Command Line

Run the following command to verify that a nftables table exists:

```bash
nft list tables
```

## Expected Result

Return should include a list of nftables.

Example:

```
table inet filter
```

## Remediation

### Command Line

Run the following command to create a table in nftables:

```bash
nft create table inet <table name>
```

Example:

```bash
nft create table inet filter
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
