---
name: cis-ubuntu1804-v220-3-3-3
description: "Ensure bogus ICMP responses are ignored"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.3

## Description

Setting `icmp_ignore_bogus_error_responses` to 1 prevents the kernel from logging bogus responses (RFC-1122 non-compliant) from broadcast reframes, keeping file systems from filling up with useless log messages.

## Rationale

Some routers (and some attackers) will send responses that violate RFC-1122 and attempt to fill up a log file system with many useless error messages.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify bogus ICMP responses are ignored:

```bash
sysctl net.ipv4.icmp_ignore_bogus_error_responses
```

```bash
grep -E '^\s*net\.ipv4\.icmp_ignore_bogus_error_responses\s*=\s*1\b' /etc/sysctl.conf /etc/sysctl.d/*.conf
```

## Expected Result

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

net.ipv4.icmp_ignore_bogus_error_responses = 1

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
