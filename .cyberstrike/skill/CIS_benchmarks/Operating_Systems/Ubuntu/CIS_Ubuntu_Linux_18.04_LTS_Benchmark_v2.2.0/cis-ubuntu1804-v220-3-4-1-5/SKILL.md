---
name: cis-ubuntu1804-v220-3-4-1-5
description: "Ensure ufw outbound connections are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.5

## Description

Configure the firewall rules for new outbound connections.

## Rationale

If rules are not in place for new outbound connections all packets will be dropped by the default policy preventing network usage.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

## Audit Procedure

### Command Line

Run the following command to verify outbound connections are configured:

```bash
ufw status verbose
```

Verify all rules for new outbound connections match site policy.

## Expected Result

Output should include rules matching site policy for outbound connections. The default outbound policy should be `allow`.

## Remediation

### Command Line

Configure ufw in accordance with site policy. The following command will allow all outbound connections:

```bash
ufw allow out on all
```

## Default Value

ufw default outbound policy is allow.

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

Manual
