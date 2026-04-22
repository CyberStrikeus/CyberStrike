---
name: cis-ubuntu1804-v220-3-4-1-4
description: "Ensure ufw loopback traffic is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.4

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network.

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify loopback traffic is configured:

```bash
ufw status verbose
```

## Expected Result

Output should include:

```
Anywhere on lo             ALLOW IN    Anywhere
Anywhere                   DENY IN     127.0.0.0/8
Anywhere (v6) on lo        ALLOW IN    Anywhere (v6)
Anywhere (v6)              DENY IN     ::1
Anywhere                   ALLOW OUT   Anywhere on lo
Anywhere (v6)              ALLOW OUT   Anywhere (v6) on lo
```

## Remediation

### Command Line

Run the following commands to configure ufw loopback traffic:

```bash
ufw allow in on lo
ufw allow out on lo
ufw deny in from 127.0.0.0/8
ufw deny in from ::1
```

## Default Value

Loopback traffic is not configured by default.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

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
