---
name: cis-ubuntu1804-v220-3-4-3-3-2
description: "Ensure ip6tables loopback traffic is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, iptables, ipv6]
cis_id: "3.4.3.3.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.3.3.2

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network (::1).

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network (::1) traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Impact

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well

## Audit Procedure

### Command Line

Run the following commands and verify output includes the listed rules in order (packet and byte counts may differ):

```bash
ip6tables -L INPUT -v -n
```

```
Chain INPUT (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      lo     *       ::/0                 ::/0
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

The INPUT chain should accept all traffic on the loopback interface and drop all traffic from ::1. The OUTPUT chain should accept all traffic going out the loopback interface. Or IPv6 is not enabled on the system.

## Remediation

### Command Line

Run the following commands to implement the loopback rules:

```bash
ip6tables -A INPUT -i lo -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -A INPUT -s ::1 -j DROP
```

## Default Value

No loopback rules are configured by default.

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
