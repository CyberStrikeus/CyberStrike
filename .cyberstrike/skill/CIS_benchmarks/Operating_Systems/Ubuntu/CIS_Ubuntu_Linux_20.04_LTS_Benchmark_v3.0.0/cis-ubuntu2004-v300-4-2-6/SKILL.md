---
name: cis-ubuntu2004-v300-4-2-6
description: "Ensure ufw outbound connections are configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw]
cis_id: "4.2.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.2.6

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Configure the firewall rules for new outbound connections.

Note:
- Changing firewall settings while connected over network can result in being locked out of the system
- Unlike iptables, when a new outbound rule is added, ufw automatically takes care of associated established connections, so no rules for the latter kind are required.

## Rationale

If rules are not in place for new outbound connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

### Command Line

Run the following command and verify all rules for new outbound connections match site policy:

```bash
ufw status numbered
```

## Expected Result

Output should show rules that match site policy for outbound connections.

## Remediation

### Command Line

Configure ufw in accordance with site policy. The following commands will implement a policy to allow all outbound connections on all interfaces:

```bash
ufw allow out on all
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
