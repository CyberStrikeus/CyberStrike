---
name: cis-ubuntu2004-v300-4-3-5
description: "Ensure nftables base chains exist"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.5

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Chains are containers for rules. They exist in two kinds, base chains and regular chains. A base chain is an entry point for packets from the networking stack, a regular chain may be used as jump target and is used for better rule organization.

## Rationale

If a base chain doesn't exist with a hook for input, forward, and delete, packets that would flow through those chains will not be touched by nftables.

## Impact

If configuring nftables over ssh, creating a `base chain` with a policy of `drop` will cause loss of connectivity.

Ensure that a rule allowing ssh has been added to the base chain prior to setting the base chain's policy to drop

## Audit Procedure

### Command Line

Run the following commands and verify that base chains exist for INPUT.

```bash
nft list ruleset | grep 'hook input'
```

```
type filter hook input priority 0;
```

Run the following commands and verify that base chains exist for FORWARD.

```bash
nft list ruleset | grep 'hook forward'
```

```
type filter hook forward priority 0;
```

Run the following commands and verify that base chains exist for OUTPUT.

```bash
nft list ruleset | grep 'hook output'
```

```
type filter hook output priority 0;
```

## Expected Result

Base chains exist for input, forward, and output hooks.

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

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0005 | M1047
