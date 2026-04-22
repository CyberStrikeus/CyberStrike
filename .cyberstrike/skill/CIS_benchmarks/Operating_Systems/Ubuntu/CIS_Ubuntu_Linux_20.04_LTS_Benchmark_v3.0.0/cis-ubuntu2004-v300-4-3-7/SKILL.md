---
name: cis-ubuntu2004-v300-4-3-7
description: "Ensure nftables outbound and established connections are configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.7

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Configure the firewall rules for new outbound, and established connections

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

### Command Line

Run the following commands and verify all rules for established incoming connections match site policy: site policy:

```bash
nft list ruleset | awk '/hook input/,/}/' | grep -E 'ip protocol (tcp|udp) ct state'
```

Output should be similar to:

```
ip protocol tcp ct state established accept
ip protocol udp ct state established accept
```

Run the following command and verify all rules for new and established outbound connections match site policy

```bash
nft list ruleset | awk '/hook output/,/}/' | grep -E 'ip protocol (tcp|udp) ct state'
```

Output should be similar to:

```
ip protocol tcp ct state established,related,new accept
ip protocol udp ct state established,related,new accept
```

## Expected Result

Established incoming and new/established outgoing connection rules are present.

## Remediation

### Command Line

Configure nftables in accordance with site policy. The following commands will implement a policy to allow all outbound connections and all established connections:

```bash
nft add rule inet filter input ip protocol tcp ct state established accept
nft add rule inet filter input ip protocol udp ct state established accept
nft add rule inet filter output ip protocol tcp ct state new,related,established accept
nft add rule inet filter output ip protocol udp ct state new,related,established accept
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562 | TA0011 | M1031, M1037
