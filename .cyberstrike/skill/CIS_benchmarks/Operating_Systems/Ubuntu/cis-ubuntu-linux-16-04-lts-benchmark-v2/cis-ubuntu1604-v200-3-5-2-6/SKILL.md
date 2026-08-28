---
name: cis-ubuntu1604-v200-3-5-2-6
description: "Ensure nftables loopback traffic is configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.6

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network.

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Audit Procedure

### Command Line

Run the following commands to verify that the loopback interface is configured:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'iif "lo" accept'
```

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'ip saddr'
```

IF IPv6 is enabled on the system, run the following command to verify that the IPv6 loopback interface is configured:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'ip6 saddr'
```

## Expected Result

```
iif "lo" accept
```

```
ip saddr 127.0.0.0/8 counter packets 0 bytes 0 drop
```

```
ip6 saddr ::1 counter packets 0 bytes 0 drop
```

## Remediation

### Command Line

Run the following commands to implement the loopback rules:

```bash
nft add rule inet filter input iif lo accept
nft create rule inet filter input ip saddr 127.0.0.0/8 counter drop
```

IF IPv6 is enabled on the system, run the following command to implement the IPv6 loopback rule:

```bash
nft add rule inet filter input ip6 saddr ::1 counter drop
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
