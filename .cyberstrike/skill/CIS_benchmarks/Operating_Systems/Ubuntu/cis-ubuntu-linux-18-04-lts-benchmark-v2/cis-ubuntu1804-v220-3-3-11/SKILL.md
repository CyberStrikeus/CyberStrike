---
name: cis-ubuntu1804-v220-3-3-11
description: "Ensure IPv6 router advertisements are not accepted"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter, ipv6]
cis_id: "3.3.11"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.11

## Description

This setting disables the system's ability to accept IPv6 router advertisements.

## Rationale

It is recommended that systems do not accept router advertisements as they could be tricked into routing traffic to compromised machines. Setting hard routes within the system (usually a single default route to a trusted router) protects the system from bad routes.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify IPv6 router advertisements are not accepted:

```bash
sysctl net.ipv6.conf.all.accept_ra
sysctl net.ipv6.conf.default.accept_ra
```

```bash
grep -E '^\s*net\.ipv6\.conf\.(all|default)\.accept_ra\s*=\s*0\b' /etc/sysctl.conf /etc/sysctl.d/*.conf
```

## Expected Result

```
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv6.conf.all.accept_ra=0
sysctl -w net.ipv6.conf.default.accept_ra=0
sysctl -w net.ipv6.route.flush=1
```

## Default Value

net.ipv6.conf.all.accept_ra = 1, net.ipv6.conf.default.accept_ra = 1

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-5, SC-7
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
