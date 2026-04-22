---
name: cis-ubuntu1204-v110-7-2-8
description: "Enable TCP SYN Cookies"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, tcp, syn-cookies, dos, sysctl, host-router]
cis_id: "7.2.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.8 Enable TCP SYN Cookies (Scored)

## Profile Applicability

- Level 1

## Description

When `tcp_syncookies` is set, the kernel will handle TCP SYN packets normally until the half-open connection queue is full, at which time, the SYN cookie functionality kicks in. SYN cookies work by not using the SYN queue at all. Instead, the kernel simply replies to the SYN with a SYN|ACK, but will include a specially crafted TCP sequence number that encodes the source and destination IP address and port number and the time the packet was sent. A legitimate connection would send the ACK packet of the three way handshake with the specially crafted sequence number. This allows the server to verify that it has received a valid response to a SYN cookie and allow the connection, even though there is no corresponding SYN in the queue.

## Rationale

Attackers use SYN flood attacks to perform a denial of service attacked on a server by sending many SYN packets without completing the three way handshake. This will quickly use up slots in the kernel's half-open connection queue and prevent legitimate connections from succeeding. SYN cookies allow the server to keep accepting valid connections, even if under a denial of service attack.

## Audit Procedure

### Using Command Line

Perform the following to determine if TCP SYN Cookies is enabled.

```bash
/sbin/sysctl net.ipv4.tcp_syncookies
```

## Expected Result

```
net.ipv4.tcp_syncookies = 1
```

## Remediation

### Using Command Line

Set the `net.ipv4.tcp_syncookies` parameter to 1 in `/etc/sysctl.conf`:

```bash
net.ipv4.tcp_syncookies=1
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.tcp_syncookies=1
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

TCP SYN Cookies are disabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
