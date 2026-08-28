---
name: cis-ubuntu1804-v220-3-3-10
description: "Ensure TCP SYN Cookies is enabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.10"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.10

## Description

When `tcp_syncookies` is set, the kernel will handle TCP SYN packets normally until the half-open connection queue is full, at which time, the SYN cookie functionality kicks in. SYN cookies work by not using the SYN queue at all. Instead, the kernel simply replies to the SYN with a SYN|ACK, but will include a specially crafted TCP sequence number that encodes the source and destination IP address and port number and the time the packet was sent. A legitimate connection would send the ACK packet of the three way handshake with the specially crafted sequence number. This allows the system to verify that it has received a valid response to a SYN cookie and allow the connection, even though there is no corresponding SYN in the queue.

## Rationale

Attackers use SYN flood attacks to perform a denial of service attacked on a system by sending many SYN packets without completing the three way handshake. This will quickly use up slots in the kernel's half-open connection queue and prevent legitimate connections from succeeding. SYN cookies allow the system to keep accepting valid connections, even if under a denial of service attack.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify TCP SYN Cookies is enabled:

```bash
sysctl net.ipv4.tcp_syncookies
```

```bash
grep -E '^\s*net\.ipv4\.tcp_syncookies\s*=\s*1\b' /etc/sysctl.conf /etc/sysctl.d/*.conf
```

## Expected Result

```
net.ipv4.tcp_syncookies = 1
```

## Remediation

### Command Line

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

net.ipv4.tcp_syncookies = 1

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-5
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.1 Establish and Maintain a Secure Configuration Process - Establish and maintain a secure configuration process for enterprise assets.

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
