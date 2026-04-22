---
name: cis-ubuntu2004-v300-4-3-8
description: "Ensure nftables default deny firewall policy"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.8

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Base chain policy is the default verdict that will be applied to packets reaching the end of the chain.

## Rationale

There are two policies: accept (Default) and drop. If the policy is set to `accept`, the firewall will accept any packet that is not configured to be denied and the packet will continue transversing the network stack.

It is easier to allow list acceptable usage than to deny list unacceptable usage.

Note:
- Allow port 22(ssh) needs to be updated to only allow systems requiring ssh connectivity to connect, as per site policy.
- Changing firewall settings while connected over network can result in being locked out of the system.

## Impact

If configuring nftables over ssh, creating a base chain with a policy of drop will cause loss of connectivity.

Ensure that a rule allowing ssh has been added to the base chain prior to setting the base chain's policy to drop

## Audit Procedure

### Command Line

Run the following commands and verify that base chains contain a policy of DROP.

```bash
nft list ruleset | grep 'hook input'
```

```
type filter hook input priority 0; policy drop;
```

```bash
nft list ruleset | grep 'hook forward'
```

```
type filter hook forward priority 0; policy drop;
```

```bash
nft list ruleset | grep 'hook output'
```

```
type filter hook output priority 0; policy drop;
```

## Expected Result

All three base chains (input, forward, output) show `policy drop;`

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

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
