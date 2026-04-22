---
name: cis-ubuntu1804-v220-3-3-9
description: "Ensure suspicious packets are logged"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.9

## Description

When enabled, this feature logs packets with un-routable source addresses to the kernel log.

## Rationale

Enabling this feature and logging these packets allows an administrator to investigate the possibility that an attacker is sending spoofed packets to their system.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify suspicious packets are logged:

```bash
sysctl net.ipv4.conf.all.log_martians
sysctl net.ipv4.conf.default.log_martians
```

```bash
grep -E '^\s*net\.ipv4\.conf\.(all|default)\.log_martians\s*=\s*1\b' /etc/sysctl.conf /etc/sysctl.d/*.conf
```

## Expected Result

```
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

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

net.ipv4.conf.all.log_martians = 0, net.ipv4.conf.default.log_martians = 0

## References

1. NIST SP 800-53 Rev. 5: AU-3, SC-5
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data.

Version 7

6.2 Activate Audit Logging - Ensure that local logging has been enabled on all systems and networking devices.

6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
