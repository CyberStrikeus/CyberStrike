---
name: cis-ubuntu2004-v300-4-4-2-3
description: "Ensure iptables outbound and established connections are configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.2.3

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Configure the firewall rules for new outbound, and established connections.

Note:

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

### Command Line

Run the following command and verify all rules for new outbound, and established connections match site policy:

```bash
iptables -L -v -n
```

## Expected Result

Output should show rules matching site policy for outbound and established connections.

## Remediation

### Command Line

Configure iptables in accordance with site policy. The following commands will implement a policy to allow all outbound connections and all established connections:

```bash
iptables -A OUTPUT -p tcp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p udp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A INPUT -p tcp -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -p udp -m state --state ESTABLISHED -j ACCEPT
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
