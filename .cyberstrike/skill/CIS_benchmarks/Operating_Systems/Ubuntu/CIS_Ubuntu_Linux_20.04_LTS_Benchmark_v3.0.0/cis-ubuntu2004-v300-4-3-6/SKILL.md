---
name: cis-ubuntu2004-v300-4-3-6
description: "Ensure nftables loopback traffic is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.6

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to the operation of the system. The loopback interface is the only place that loopback network traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Audit Procedure

### Command Line

Run the following commands to verify that the loopback interface is configured:
Run the following command to verify the loopback interface is configured to accept network traffic:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'iif "lo" accept'
```

Example output:

```
iif "lo" accept
```

Run the following command to verify network traffic from an IPv4 loopback interface is configured to drop:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'ip saddr'
```

Example output:

```
ip saddr 127.0.0.0/8 counter packets 0 bytes 0 drop
```

- IF - IPv6 is enabled on the system:
  Run the following command to verify network traffic from an IPv6 loopback interface is configured to drop:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep 'ip6 saddr'
```

Example output:

```
ip6 saddr ::1 counter packets 0 bytes 0 drop
```

## Expected Result

Loopback accept rule exists, and drop rules for 127.0.0.0/8 and ::1 are present.

## Remediation

### Command Line

Run the following commands to implement the loopback rules:

```bash
nft add rule inet filter input iif lo accept
nft add rule inet filter input ip saddr 127.0.0.0/8 counter drop
```

- IF - IPv6 is enabled on the system:
  Run the following command to implement the IPv6 loopback rule:

```bash
nft add rule inet filter input ip6 saddr ::1 counter drop
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0005
