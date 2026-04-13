---
name: cis-gcp-cos-3.2.4
description: "Ensure suspicious packets are logged"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, network, sysctl, routing]
cis_id: "3.2.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.4 Ensure suspicious packets are logged (Automated)

## Description

When enabled, this feature logs packets with un-routable source addresses to the kernel log.

## Rationale

Enabling this feature and logging these packets allows an administrator to investigate the possibility that an attacker is sending spoofed packets to their system.

## Audit Procedure

Run the following commands and verify output matches:

```bash
# sysctl net.ipv4.conf.all.log_martians
net.ipv4.conf.all.log_martians = 1
# sysctl net.ipv4.conf.default.log_martians
net.ipv4.conf.default.log_martians = 1
```

## Expected Result

Both sysctl commands should return a value of `1`, confirming that suspicious (martian) packets are being logged.

## Remediation

Run the following commands to set the active kernel parameters:

```bash
# sysctl -w net.ipv4.conf.all.log_martians=1
# sysctl -w net.ipv4.conf.default.log_martians=1
# sysctl -w net.ipv4.route.flush=1
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.2 Collect Audit Logs** - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | X | X | X |
| v8 | **8.5 Collect Detailed Audit Logs** - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | X | X |
| v7 | **6.2 Activate audit logging** - Ensure that local logging has been enabled on all systems and networking devices. | X | X | X |
| v7 | **6.3 Enable Detailed Logging** - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | X | X |

## Profile

- Level 2 - Server
