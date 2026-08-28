---
name: cis-ubuntu1804-v220-3-4-2-8
description: "Ensure nftables default deny firewall policy"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, nftables]
cis_id: "3.4.2.8"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.2.8

## Description

Base chain policy is the default verdict that will be applied to packets reaching the end of the chain.

## Rationale

There are two policies: accept (Default) and drop. If the policy is set to `accept`, the firewall will accept any packet that is not configured to be denied and the packet will continue transversing the network stack.

It is easier to allow list acceptable usage than to deny list unacceptable usage.

Note: Changing firewall settings while connected over network can result in being locked out of the system.

## Impact

If configuring nftables over ssh, creating a base chain with a policy of drop will cause loss of connectivity.

Ensure that a rule allowing ssh has been added to the base chain prior to setting the base chain's policy to drop.

## Audit Procedure

### Command Line

Run the following commands and verify that base chains contain a policy of `DROP`:

```bash
nft list ruleset | grep 'hook input'
nft list ruleset | grep 'hook forward'
nft list ruleset | grep 'hook output'
```

## Expected Result

```
type filter hook input priority 0; policy drop;
type filter hook forward priority 0; policy drop;
type filter hook output priority 0; policy drop;
```

## Remediation

### Command Line

Run the following command for the base chains with the input, forward, and output hooks to implement a default DROP policy:

```bash
nft chain <table family> <table name> <chain name> { policy drop \; }
```

Example:

```bash
nft chain inet filter input { policy drop \; }
nft chain inet filter forward { policy drop \; }
nft chain inet filter output { policy drop \; }
```

## Default Value

accept

## References

1. Manual Page nft
2. NIST SP 800-53 Rev. 5: CA-9, SC-7

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
