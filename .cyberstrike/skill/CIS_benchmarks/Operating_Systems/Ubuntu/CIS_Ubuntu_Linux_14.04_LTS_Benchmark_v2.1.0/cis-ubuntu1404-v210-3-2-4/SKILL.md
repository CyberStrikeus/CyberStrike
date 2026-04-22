---
name: "CIS Ubuntu 14.04 LTS - 3.2.4 Ensure suspicious packets are logged"
description: "Verify that packets with un-routable source addresses are logged for investigation"
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
cis_id: "3.2.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.2.4 Ensure suspicious packets are logged (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

When enabled, this feature logs packets with un-routable source addresses to the kernel log.

## Rationale

Enabling this feature and logging these packets allows an administrator to investigate the possibility that an attacker is sending spoofed packets to their system.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.conf.all.log_martians
# Expected: net.ipv4.conf.all.log_martians = 1

sysctl net.ipv4.conf.default.log_martians
# Expected: net.ipv4.conf.default.log_martians = 1

grep "net\.ipv4\.conf\.all\.log_martians" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.all.log_martians = 1

grep "net\.ipv4\.conf\.default\.log_martians" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.default.log_martians = 1
```

## Expected Result

```
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
```

## Remediation

Set the following parameters in `/etc/sysctl.conf` or `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.log_martians=1
sysctl -w net.ipv4.conf.default.log_martians=1
sysctl -w net.ipv4.route.flush=1
```

## Default Value

Not specified. Note: It has been reported that due to Ubuntu bug #50093 this setting (and some others) can fail to apply properly on reboot requiring it to be manually re-applied. One method of accomplishing this is to add `sysctl -p` to run on reboot to your systems crontab.

## References

- CIS Controls: 6 - Maintenance, Monitoring, and Analysis of Audit Logs

## Profile

- Level 1 - Server
- Level 1 - Workstation
