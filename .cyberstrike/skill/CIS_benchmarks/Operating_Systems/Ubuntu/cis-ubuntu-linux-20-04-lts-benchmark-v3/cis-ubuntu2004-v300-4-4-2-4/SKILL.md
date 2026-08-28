---
name: cis-ubuntu2004-v300-4-4-2-4
description: "Ensure iptables firewall rules exist for all open ports"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.2.4

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

Notes:

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well
- The remediation command opens up the port to traffic from all sources. Consult iptables documentation and set any restrictions in compliance with site policy

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Audit Procedure

### Command Line

Run the following command to determine open ports:

```bash
ss -4tuln
```

```
Netid  State      Recv-Q Send-Q    Local Address:Port         Peer Address:Port
udp    UNCONN     0      0                    *:68                       *:*
udp    UNCONN     0      0                    *:123                      *:*
tcp    LISTEN     0      128                  *:22                       *:*
```

Run the following command to determine firewall rules:

```bash
iptables -L INPUT -v -n
```

```
Chain INPUT (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all  --  lo     *       0.0.0.0/0            0.0.0.0/0
    0     0 DROP       all  --  *      *       127.0.0.0/8          0.0.0.0/0
    0     0 ACCEPT     tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:22 state NEW
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule. The last line identified by the `tcp dpt:22 state NEW` identifies it as a firewall rule for new connections on tcp port 22.

## Expected Result

All open ports on non-localhost addresses have corresponding iptables rules.

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
iptables -A INPUT -p <protocol> --dport <port> -m state --state NEW -j ACCEPT
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
