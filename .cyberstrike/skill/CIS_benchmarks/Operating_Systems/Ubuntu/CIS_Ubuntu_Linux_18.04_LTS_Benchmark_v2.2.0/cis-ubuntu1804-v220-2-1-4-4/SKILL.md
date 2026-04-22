---
name: cis-ubuntu1804-v220-2-1-4-4
description: "Ensure ntp is enabled and running"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, ntp]
cis_id: "2.1.4.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.4.4 Ensure ntp is enabled and running (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

ntp is a daemon for synchronizing the system clock across the network.

## Rationale

ntp needs to be enabled and running in order to synchronize the system to a timeserver.

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF ntp is in use on the system, run the following commands:

Run the following command to verify that the ntp service is enabled:
```bash
# systemctl is-enabled ntp.service
enabled
```

Run the following command to verify that the ntp service is active:
```bash
# systemctl is-active ntp.service
active
```

## Expected Result

- `systemctl is-enabled ntp.service` returns `enabled`
- `systemctl is-active ntp.service` returns `active`

## Remediation

### Command Line

IF ntp is in use on the system, run the following commands:

Run the following command to unmask ntp.service:
```bash
# systemctl unmask ntp.service
```

Run the following command to enable and start ntp.service:
```bash
# systemctl --now enable ntp.service
```

OR

If another time synchronization service is in use on the system, run the following command to remove ntp:
```bash
# apt purge ntp
```

## References

1. NIST SP 800-53 Rev. 5: AU-7, AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
