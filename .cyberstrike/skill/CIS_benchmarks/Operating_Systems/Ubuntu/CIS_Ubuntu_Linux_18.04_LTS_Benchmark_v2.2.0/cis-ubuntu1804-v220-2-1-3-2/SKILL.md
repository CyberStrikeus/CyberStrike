---
name: cis-ubuntu1804-v220-2-1-3-2
description: "Ensure systemd-timesyncd is enabled and running"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, systemd-timesyncd]
cis_id: "2.1.3.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.3.2 Ensure systemd-timesyncd is enabled and running (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

systemd-timesyncd is a daemon that has been added for synchronizing the system clock across the network.

## Rationale

systemd-timesyncd needs to be enabled and running in order to synchronize the system to a timeserver.

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations.

## Audit Procedure

### Command Line

IF systemd-timesyncd is in use on the system, run the following commands:

Run the following command to verify that the systemd-timesyncd service is enabled:
```bash
# systemctl is-enabled systemd-timesyncd.service
enabled
```

Run the following command to verify that the systemd-timesyncd service is active:
```bash
# systemctl is-active systemd-timesyncd.service
active
```

## Expected Result

- `systemctl is-enabled systemd-timesyncd.service` returns `enabled`
- `systemctl is-active systemd-timesyncd.service` returns `active`

## Remediation

### Command Line

IF systemd-timesyncd is in use on the system, run the following commands:

Run the following command to unmask systemd-timesyncd.service:
```bash
# systemctl unmask systemd-timesyncd.service
```

Run the following command to enable and start systemd-timesyncd.service:
```bash
# systemctl --now enable systemd-timesyncd.service
```

OR

If another time synchronization service is in use on the system, run the following command to stop and mask systemd-timesyncd:
```bash
# systemctl --now mask systemd-timesyncd.service
```

## References

1. NIST SP 800-53 Rev. 5: AU-7, AU-8

## CIS Controls

- v8: 8.4 - Standardize Time Synchronization
- v7: 6.1 - Utilize Three Synchronized Time Sources
