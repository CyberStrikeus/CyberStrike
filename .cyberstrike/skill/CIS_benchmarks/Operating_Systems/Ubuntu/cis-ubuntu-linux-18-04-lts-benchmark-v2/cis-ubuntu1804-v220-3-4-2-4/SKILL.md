---
name: cis-ubuntu1804-v220-3-4-2-4
description: "Ensure a nftables table exists"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, nftables]
cis_id: "3.4.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.2.4

## Description

Tables hold chains. Each table only has one address family and only applies to packets of this family. Tables can have one of five families.

## Rationale

nftables doesn't have any default tables. Without a table being built, nftables will not filter network traffic.

## Impact

Adding a table to nftables will not by itself change the way network traffic is handled.

## Audit Procedure

### Command Line

Run the following command to verify that a nftables table exists:

```bash
nft list tables
```

## Expected Result

Output should include a table, for example:

```
table inet filter
```

## Remediation

### Command Line

Run the following command to create a table in nftables:

```bash
nft create table inet filter
```

## Default Value

No nftables table exists by default.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.4 Implement and Manage a Firewall on Servers - Implement and manage a firewall on servers, where supported.

4.5 Implement and Manage a Firewall on End-User Devices - Implement and manage a host-based firewall or port-filtering tool on end-user devices.

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
