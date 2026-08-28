---
name: cis-ubuntu2004-v300-4-4-3-2
description: "Ensure ip6tables loopback traffic is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.3.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.3.2

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network (::1).

Note:

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network (::1) traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Audit Procedure

### Command Line

Run the following commands and verify output includes the listed rules in order (packet and byte counts may differ):

```bash
ip6tables -L INPUT -v -n
```

```
Chain INPUT (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      *      *       ::/0                 ::/0
    0     0 DROP       all      *      *       ::1                  ::/0
```

```bash
ip6tables -L OUTPUT -v -n
```

```
Chain OUTPUT (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      *      lo      ::/0                 ::/0
```

- OR -
  Verify IPv6 is disabled:
  Run the following script. Output will confirm if IPv6 is enabled on the system.

```bash
#!/usr/bin/env bash

{
  l_ipv6_enabled="is"
  ! grep -Pqs -- '^\h*0\b' /sys/module/ipv6/parameters/disable && l_ipv6_enabled="is not"
  if sysctl net.ipv6.conf.all.disable_ipv6 | grep -Pqs -- "^\h*net\.ipv6\.conf\.all\.disable_ipv6\h*=\h*1\b" \
  && \
    sysctl net.ipv6.conf.default.disable_ipv6 | grep -Pqs -- "^\h*net\.ipv6\.conf\.default\.disable_ipv6\h*=\h*1\b"; then
      l_ipv6_enabled="is not"
  fi
  echo -e " - IPv6 $l_ipv6_enabled enabled on the system"
}
```

## Expected Result

INPUT chain accepts loopback traffic and drops traffic from ::1. OUTPUT chain accepts outbound loopback traffic. Or IPv6 is disabled.

## Remediation

### Command Line

Run the following commands to implement the loopback rules:

```bash
ip6tables -A INPUT -i lo -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -A INPUT -s ::1 -j DROP
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
