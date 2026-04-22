---
name: cis-ubuntu1804-v220-3-4-2-5
description: "Ensure nftables base chains exist"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, nftables]
cis_id: "3.4.2.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.2.5

## Description

Chains are containers for rules. They exist in two kinds: base chains and regular chains. A base chain is an entry point for packets from the networking stack, a regular chain may be used as jump target and is used for better rule organization.

## Rationale

If a base chain doesn't exist matching network traffic will be unaffected. Without base chains, no network traffic will be filtered.

## Impact

If configuring nftables over ssh, creating a base chain with a policy of drop will cause loss of connectivity. Ensure that a rule allowing ssh has been added to the base chain prior to setting the base chain's policy to drop.

## Audit Procedure

### Command Line

Run the following commands to verify that base chains exist for INPUT, FORWARD, and OUTPUT:

```bash
nft list ruleset | grep 'hook input'
nft list ruleset | grep 'hook forward'
nft list ruleset | grep 'hook output'
```

## Expected Result

```
type filter hook input priority 0;
type filter hook forward priority 0;
type filter hook output priority 0;
```

## Remediation

### Command Line

Run the following commands to create base chains:

```bash
nft create chain inet filter input { type filter hook input priority 0 \; }
nft create chain inet filter forward { type filter hook forward priority 0 \; }
nft create chain inet filter output { type filter hook output priority 0 \; }
```

## Default Value

No base chains exist by default.

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
