---
name: "CIS Ubuntu 14.04 LTS - 3.2.8 Ensure TCP SYN Cookies is enabled"
description: "Verify that TCP SYN Cookies are enabled to protect against SYN flood attacks"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - network
cis_id: "3.2.8"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.2.8 Ensure TCP SYN Cookies is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

When `tcp_syncookies` is set, the kernel will handle TCP SYN packets normally until the half-open connection queue is full, at which time, the SYN cookie functionality kicks in. SYN cookies work by not using the SYN queue at all. Instead, the kernel simply replies to the SYN with a SYN|ACK, but will include a specially crafted TCP sequence number that encodes the source and destination IP address and port number and the time the packet was sent. A legitimate connection would send the ACK packet of the three way handshake with the specially crafted sequence number. This allows the system to verify that it has received a valid response to a SYN cookie and allow the connection, even though there is no corresponding SYN in the queue.

## Rationale

Attackers use SYN flood attacks to perform a denial of service attacked on a system by sending many SYN packets without completing the three way handshake. This will quickly use up slots in the kernel's half-open connection queue and prevent legitimate connections from succeeding. SYN cookies allow the system to keep accepting valid connections, even if under a denial of service attack.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.tcp_syncookies
# Expected: net.ipv4.tcp_syncookies = 1

grep "net\.ipv4\.tcp_syncookies" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.tcp_syncookies = 1
```

## Expected Result

```
net.ipv4.tcp_syncookies = 1
```

## Remediation

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.tcp_syncookies = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.tcp_syncookies=1
sysctl -w net.ipv4.route.flush=1
```

## Default Value

Not specified.

## References

- CIS Controls: 3 - Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
- CIS Controls: 11 - Secure Configurations for Network Devices such as Firewalls, Routers and switches

## Profile

- Level 1 - Server
- Level 1 - Workstation
