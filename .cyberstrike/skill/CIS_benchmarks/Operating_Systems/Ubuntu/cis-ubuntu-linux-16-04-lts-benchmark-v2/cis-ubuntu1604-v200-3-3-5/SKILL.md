---
name: cis-ubuntu1604-v200-3-3-5
description: "Ensure broadcast ICMP requests are ignored"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.3.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.3.5

## Description

Setting `net.ipv4.icmp_echo_ignore_broadcasts` to 1 will cause the system to ignore all ICMP echo and timestamp requests to broadcast and multicast addresses.

## Rationale

Accepting ICMP echo and timestamp requests with broadcast or multicast destinations for your network could be used to trick your host into starting (or participating) in a Smurf attack. A Smurf attack relies on an attacker sending large amounts of ICMP broadcast messages with a spoofed source address. All hosts receiving this message and responding would send echo-reply messages back to the spoofed address, which is probably not routable. If many hosts respond to the packets, the amount of traffic on the network could be significantly multiplied.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.icmp_echo_ignore_broadcasts
```

```bash
grep "net\.ipv4\.icmp_echo_ignore_broadcasts" /etc/sysctl.conf /etc/sysctl.d/*
```

## Expected Result

```
net.ipv4.icmp_echo_ignore_broadcasts = 1
```

And the grep command should return:

```
net.ipv4.icmp_echo_ignore_broadcasts = 1
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.icmp_echo_ignore_broadcasts = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=1
sysctl -w net.ipv4.route.flush=1
```

## Default Value

icmp_echo_ignore_broadcasts is enabled (set to 1) by default.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
