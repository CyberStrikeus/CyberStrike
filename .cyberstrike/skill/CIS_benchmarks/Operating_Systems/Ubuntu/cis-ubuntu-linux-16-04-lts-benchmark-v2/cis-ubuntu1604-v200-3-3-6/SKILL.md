---
name: cis-ubuntu1604-v200-3-3-6
description: "Ensure bogus ICMP responses are ignored"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.3.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.3.6

## Description

Setting `icmp_ignore_bogus_error_responses` to 1 prevents the kernel from logging bogus responses (RFC-1122 non-compliant) from broadcast reframes, keeping file systems from filling up with useless log messages.

## Rationale

Some routers (and some attackers) will send responses that violate RFC-1122 and attempt to fill up a log file system with many useless error messages.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.icmp_ignore_bogus_error_responses
```

```bash
grep "net.ipv4.icmp_ignore_bogus_error_responses" /etc/sysctl.conf /etc/sysctl.d/*
```

## Expected Result

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

And the grep command should return:

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.icmp_ignore_bogus_error_responses=1
sysctl -w net.ipv4.route.flush=1
```

## Default Value

icmp_ignore_bogus_error_responses is enabled (set to 1) by default.

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
