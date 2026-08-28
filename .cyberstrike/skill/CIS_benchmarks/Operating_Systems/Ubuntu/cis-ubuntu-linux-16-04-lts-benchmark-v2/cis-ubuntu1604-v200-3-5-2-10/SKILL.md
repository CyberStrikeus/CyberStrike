---
name: cis-ubuntu1604-v200-3-5-2-10
description: "Ensure nftables rules are permanent"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.10"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.10

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

nftables is a subsystem of the Linux kernel providing filtering and classification of network packets/datagrams/frames.

The nftables service reads the `/etc/nftables.conf` file for a nftables file or files to include in the nftables ruleset.

A nftables ruleset containing the input, forward, and output base chains allow network traffic to be filtered.

## Rationale

Changes made to nftables ruleset only affect the live system, you will also need to configure the nftables ruleset to apply on boot.

## Audit Procedure

### Command Line

Run the following commands to verify that input, forward, and output base chains are configured to be applied to a nftables ruleset on boot.

Run the following command to verify the input base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook input/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Review the input base chain to ensure that it follows local site policy.

Run the following command to verify the forward base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook forward/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Review the forward base chain to ensure that it follows local site policy.

Run the following command to verify the output base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook output/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Review the output base chain to ensure that it follows local site policy.

## Remediation

### Command Line

Edit the `/etc/nftables.conf` file and un-comment or add a line with `include <Absolute path to nftables rules file>` for each nftables file you want included in the nftables ruleset on boot.

Example:

```bash
vi /etc/nftables.conf
```

Add the line:

```
include "/etc/nftables.rules"
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
