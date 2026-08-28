---
name: "CIS Ubuntu 14.04 LTS - 3.2.3 Ensure secure ICMP redirects are not accepted"
description: "Verify that secure ICMP redirects are not accepted to prevent routing table manipulation from known gateways"
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
cis_id: "3.2.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.2.3 Ensure secure ICMP redirects are not accepted (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Secure ICMP redirects are the same as ICMP redirects, except they come from gateways listed on the default gateway list. It is assumed that these gateways are known to your system, and that they are likely to be secure.

## Rationale

It is still possible for even known gateways to be compromised. Setting `net.ipv4.conf.all.secure_redirects` to 0 protects the system from routing table updates by possibly compromised known gateways.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.conf.all.secure_redirects
# Expected: net.ipv4.conf.all.secure_redirects = 0

sysctl net.ipv4.conf.default.secure_redirects
# Expected: net.ipv4.conf.default.secure_redirects = 0

grep "net\.ipv4\.conf\.all\.secure_redirects" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.all.secure_redirects= 0

grep "net\.ipv4\.conf\.default\.secure_redirects" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.default.secure_redirects= 0
```

## Expected Result

```
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
```

## Remediation

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

Not specified. Note: It has been reported that due to Ubuntu bug #50093 this setting (and some others) can fail to apply properly on reboot requiring it to be manually re-applied. One method of accomplishing this is to add `sysctl -p` to run on reboot to your systems crontab.

## References

- CIS Controls: 3 - Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
- CIS Controls: 11 - Secure Configurations for Network Devices such as Firewalls, Routers and switches

## Profile

- Level 1 - Server
- Level 1 - Workstation
