---
name: cis-ubuntu1804-v220-2-1-2-3
description: "Ensure chrony is enabled and running"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, chrony]
cis_id: "2.1.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2.3 Ensure chrony is enabled and running (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

chrony is a daemon for synchronizing the system clock across the network.

## Rationale

chrony needs to be enabled and running in order to synchronize the system to a timeserver.

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF chrony is in use on the system, run the following commands:

Run the following command to verify that the chrony service is enabled:

```bash
# systemctl is-enabled chrony.service
enabled
```

Run the following command to verify that the chrony service is active:

```bash
# systemctl is-active chrony.service
active
```

## Expected Result

- `systemctl is-enabled chrony.service` returns `enabled`
- `systemctl is-active chrony.service` returns `active`

## Remediation

### Command Line

IF chrony is in use on the system, run the following commands:

Run the following command to unmask chrony.service:

```bash
# systemctl unmask chrony.service
```

Run the following command to enable and start chrony.service:

```bash
# systemctl --now enable chrony.service
```

OR

If another time synchronization service is in use on the system, run the following command to remove chrony:

```bash
# apt purge chrony
```

## References

1. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
