---
name: "CIS Ubuntu 14.04 LTS - 3.6.2 Ensure default deny firewall policy"
description: "Verify that default deny firewall policy is configured for INPUT, OUTPUT, and FORWARD chains"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - firewall
  - network
cis_id: "3.6.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 3.6.2 Ensure default deny firewall policy (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

A default deny all policy on connections ensures that any unconfigured network usage will be rejected.

## Rationale

With a default accept policy the firewall will accept any packet that is not configured to be denied. It is easier to white list acceptable usage than to black list unacceptable usage.

## Audit Procedure

Run the following command and verify that the policy for the INPUT, OUTPUT, and FORWARD chains is DROP or REJECT:

```bash
iptables -L
# Expected:
# Chain INPUT (policy DROP)
# Chain FORWARD (policy DROP)
# Chain OUTPUT (policy DROP)
```

## Expected Result

```
Chain INPUT (policy DROP)
Chain FORWARD (policy DROP)
Chain OUTPUT (policy DROP)
```

## Remediation

Run the following commands to implement a default DROP policy:

```bash
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP
```

## Default Value

Not configured. Note: Changing firewall settings while connected over network can result in being locked out of the system. Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## References

- CIS Controls: 9.2 - Leverage Host-based Firewalls

## Profile

- Level 1 - Server
- Level 1 - Workstation
