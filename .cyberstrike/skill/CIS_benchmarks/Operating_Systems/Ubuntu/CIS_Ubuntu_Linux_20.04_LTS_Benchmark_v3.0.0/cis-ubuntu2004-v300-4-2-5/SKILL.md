---
name: cis-ubuntu2004-v300-4-2-5
description: "Ensure ufw loopback traffic is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw]
cis_id: "4.2.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.2.5

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network (127.0.0.0/8 for IPv4 and ::1/128 for IPv6).

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network (127.0.0.0/8 for IPv4 and ::1/128 for IPv6) traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Audit Procedure

### Command Line

Run the following command and verify loopback interface to accept traffic:

```bash
grep -P -- 'lo|127.0.0.0' /etc/ufw/before.rules
```

Output includes:

```
# allow all on loopback
-A ufw-before-input -i lo -j ACCEPT
-A ufw-before-output -o lo -j ACCEPT
```

Run the following command and verify all other interfaces deny traffic to the loopback network (127.0.0.0/8 for IPv4 and ::1/128 for IPv6):

```bash
ufw status verbose
```

```
To                         Action      From
--                         ------      ----
Anywhere                   DENY IN     127.0.0.0/8
Anywhere (v6)              DENY IN     ::1
```

Note: `ufw status` only shows rules added with `ufw` and not the rules found in the `/etc/ufw` rules files where allow all on loopback is configured by default.

## Expected Result

Loopback accept rules present in before.rules and deny rules for 127.0.0.0/8 and ::1 in ufw status.

## Remediation

### Command Line

Run the following commands to configure the loopback interface to accept traffic:

```bash
ufw allow in on lo
ufw allow out on lo
```

Run the following commands to configure all other interfaces to deny traffic to the loopback network:

```bash
ufw deny in from 127.0.0.0/8
ufw deny in from ::1
```

## Default Value

```
# allow all on loopback
-A ufw-before-input -i lo -j ACCEPT
-A ufw-before-output -o lo -j ACCEPT
```

## References

1. NIST SP 800-53 Rev. 5: SC-7
2. https://manpages.ubuntu.com/manpages/jammy/en/man8/ufw-framework.8.html

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
