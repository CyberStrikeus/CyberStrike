---
name: cis-ubuntu1604-v200-3-5-1-7
description: "Ensure ufw default deny firewall policy"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.1.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.1.7

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

A default deny policy on connections ensures that any unconfigured network usage will be rejected.

Note: Any port or protocol without a explicit allow before the default deny will be blocked.

## Rationale

With a default accept policy the firewall will accept any packet that is not configured to be denied. It is easier to white list acceptable usage than to black list unacceptable usage.

## Impact

Any port and protocol not explicitly allowed will be blocked. The following rules should be considered before applying the default deny:

```
ufw allow git
ufw allow in http
ufw allow in https
ufw allow out 53
ufw logging on
```

## Audit Procedure

### Command Line

Run the following command and verify that the default policy for **incoming**, **outgoing**, and **routed** directions is **deny** or **reject**:

```bash
ufw status verbose
```

## Remediation

### Command Line

Run the following commands to implement a default deny policy:

```bash
ufw default deny incoming
ufw default deny outgoing
ufw default deny routed
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
