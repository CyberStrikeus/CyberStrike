---
name: cis-ubuntu1604-v200-3-5-2-5
description: "Ensure nftables base chains exist"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.5

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Chains are containers for rules. They exist in two kinds, base chains and regular chains. A base chain is an entry point for packets from the networking stack, a regular chain may be used as jump target and is used for better rule organization.

## Rationale

If a base chain doesn't exist with a hook for input, forward, and delete, packets that would flow through those chains will not be touched by nftables.

## Impact

If configuring nftables over ssh, creating a base chain with a policy of drop will cause loss of connectivity.

Ensure that a rule allowing ssh has been added to the base chain prior to setting the base chain's policy to drop.

## Audit Procedure

### Command Line

Run the following commands and verify that base chains exist for INPUT.

```bash
nft list ruleset | grep 'hook input'
```

Run the following commands and verify that base chains exist for FORWARD.

```bash
nft list ruleset | grep 'hook forward'
```

Run the following commands and verify that base chains exist for OUTPUT.

```bash
nft list ruleset | grep 'hook output'
```

## Expected Result

```
type filter hook input priority 0;
```

```
type filter hook forward priority 0;
```

```
type filter hook output priority 0;
```

## Remediation

### Command Line

Run the following command to create the base chains:

```bash
nft create chain inet <table name> <base chain name> { type filter hook <(input|forward|output)> priority 0 \; }
```

Example:

```bash
nft create chain inet filter input { type filter hook input priority 0 \; }
nft create chain inet filter forward { type filter hook forward priority 0 \; }
nft create chain inet filter output { type filter hook output priority 0 \; }
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
