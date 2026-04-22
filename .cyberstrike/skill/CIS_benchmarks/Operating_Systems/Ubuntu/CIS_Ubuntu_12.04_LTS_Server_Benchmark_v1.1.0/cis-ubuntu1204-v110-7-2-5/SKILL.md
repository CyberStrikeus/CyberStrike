---
name: cis-ubuntu1204-v110-7-2-5
description: "Enable Ignore Broadcast Requests"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, icmp, broadcast, smurf, sysctl, host-router]
cis_id: "7.2.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.5 Enable Ignore Broadcast Requests (Scored)

## Profile Applicability

- Level 1

## Description

Setting `net.ipv4.icmp_echo_ignore_broadcasts` to 1 will cause the system to ignore all ICMP echo and timestamp requests to broadcast and multicast addresses.

## Rationale

Accepting ICMP echo and timestamp requests with broadcast or multicast destinations for your network could be used to trick your host into starting (or participating) in a Smurf attack. A Smurf attack relies on an attacker sending large amounts of ICMP broadcast messages with a spoofed source address. All hosts receiving this message and responding would send echo-reply messages back to the spoofed address, which is probably not routable. If many hosts respond to the packets, the amount of traffic on the network could be significantly multiplied.

## Audit Procedure

### Using Command Line

Perform the following to determine if all ICMP echo and timestamp requests to broadcast and multicast addresses will be ignored.

```bash
/sbin/sysctl net.ipv4.icmp_echo_ignore_broadcasts
```

## Expected Result

```
net.ipv4.icmp_echo_ignore_broadcasts = 1
```

## Remediation

### Using Command Line

Set the `net.ipv4.icmp_echo_ignore_broadcasts` parameter to 1 in `/etc/sysctl.conf`:

```bash
net.ipv4.icmp_echo_ignore_broadcasts=1
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=1
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Broadcast ICMP requests are accepted by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
