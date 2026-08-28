---
name: cis-ubuntu1804-v220-3-3-6
description: "Ensure secure ICMP redirects are not accepted"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.6

## Description

Secure ICMP redirects are the same as ICMP redirects, except they come from gateways listed in the default gateway list. It is assumed that these gateways are known to be legitimate, so the risk is lower. However, it is still possible for even known gateways to be compromised.

## Rationale

It is still possible for even known gateways to be compromised. Setting `net.ipv4.conf.all.secure_redirects` to 0 protects the system from routing table updates by possibly compromised known gateways.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify secure ICMP redirects are not accepted:

```bash
sysctl net.ipv4.conf.all.secure_redirects
sysctl net.ipv4.conf.default.secure_redirects
```

```bash
grep -E '^\s*net\.ipv4\.conf\.(all|default)\.secure_redirects\s*=\s*0\b' /etc/sysctl.conf /etc/sysctl.d/*.conf
```

## Expected Result

```
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.secure_redirects=0
sysctl -w net.ipv4.conf.default.secure_redirects=0
sysctl -w net.ipv4.route.flush=1
```

## Default Value

net.ipv4.conf.all.secure_redirects = 1, net.ipv4.conf.default.secure_redirects = 1

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
