---
name: cis-ubuntu1604-v200-3-3-2
description: "Ensure ICMP redirects are not accepted"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.3.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.3.2

## Description

ICMP redirect messages are packets that convey routing information and tell your host (acting as a router) to send packets via an alternate path. It is a way of allowing an outside routing device to update your system routing tables. By setting `net.ipv4.conf.all.accept_redirects` and `net.ipv6.conf.all.accept_redirects` to 0, the system will not accept any ICMP redirect messages, and therefore, won't allow outsiders to update the system's routing tables.

## Rationale

Attackers could use bogus ICMP redirect messages to maliciously alter the system routing tables and get them to send packets to incorrect networks and allow your system packets to be captured.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.conf.all.accept_redirects
```

```bash
sysctl net.ipv4.conf.default.accept_redirects
```

```bash
grep "net\.ipv4\.conf\.all\.accept_redirects" /etc/sysctl.conf /etc/sysctl.d/*
```

```bash
grep "net\.ipv4\.conf\.default\.accept_redirects" /etc/sysctl.conf /etc/sysctl.d/*
```

_IF IPv6 is enabled:_

Run the following commands and verify output matches:

```bash
sysctl net.ipv6.conf.all.accept_redirects
```

```bash
sysctl net.ipv6.conf.default.accept_redirects
```

```bash
grep "net\.ipv6\.conf\.all\.accept_redirects" /etc/sysctl.conf /etc/sysctl.d/*
```

```bash
grep "net\.ipv6\.conf\.default\.accept_redirects" /etc/sysctl.conf /etc/sysctl.d/*
```

_OR verify IPv6 is disabled._

## Expected Result

```
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
```

And the grep commands should return:

```
net.ipv4.conf.all.accept_redirects= 0
net.ipv4.conf.default.accept_redirects= 0
```

If IPv6 is enabled:

```
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
```

And the grep commands should return:

```
net.ipv6.conf.all.accept_redirects= 0
net.ipv6.conf.default.accept_redirects= 0
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.accept_redirects=0
sysctl -w net.ipv4.conf.default.accept_redirects=0
sysctl -w net.ipv4.route.flush=1
```

_IF IPv6 is enabled:_

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv6.conf.all.accept_redirects=0
sysctl -w net.ipv6.conf.default.accept_redirects=0
sysctl -w net.ipv6.route.flush=1
```

## Default Value

accept_redirects is enabled (set to 1) by default.

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
