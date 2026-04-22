---
name: cis-ubuntu1804-v220-3-4-3-3-3
description: "Ensure ip6tables outbound and established connections are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, iptables, ipv6]
cis_id: "3.4.3.3.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.3.3.3

## Description

Configure the firewall rules for new outbound, and established IPv6 connections.

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Impact

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well

## Audit Procedure

### Command Line

Run the following command and verify all rules for new outbound, and established connections match site policy:

```bash
ip6tables -L -v -n
```

-OR-

Verify IPv6 is disabled:
Run the following script. Output will confirm if IPv6 is enabled on the system.

```bash
#!/usr/bin/bash
{
  if grep -Pqs '^\h*0\b' /sys/module/ipv6/parameters/disable; then
    echo -e " - IPv6 is enabled on the system"
  else
    echo -e " - IPv6 is not enabled on the system"
  fi
}
```

## Expected Result

The output should show rules matching site policy for outbound and established IPv6 connections. Or IPv6 is not enabled on the system.

## Remediation

### Command Line

Configure iptables in accordance with site policy. The following commands will implement a policy to allow all outbound connections and all established connections:

```bash
ip6tables -A OUTPUT -p tcp -m state --state NEW,ESTABLISHED -j ACCEPT
ip6tables -A OUTPUT -p udp -m state --state NEW,ESTABLISHED -j ACCEPT
ip6tables -A OUTPUT -p icmp -m state --state NEW,ESTABLISHED -j ACCEPT
ip6tables -A INPUT -p tcp -m state --state ESTABLISHED -j ACCEPT
ip6tables -A INPUT -p udp -m state --state ESTABLISHED -j ACCEPT
ip6tables -A INPUT -p icmp -m state --state ESTABLISHED -j ACCEPT
```

## Default Value

No connection tracking rules exist by default.

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
