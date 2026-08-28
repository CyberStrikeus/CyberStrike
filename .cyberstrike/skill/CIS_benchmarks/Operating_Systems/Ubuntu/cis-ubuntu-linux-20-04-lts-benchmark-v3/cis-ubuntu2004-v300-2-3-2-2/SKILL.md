---
name: cis-ubuntu2004-v300-2-3-2-2
description: "Ensure systemd-timesyncd is enabled and running"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, systemd-timesyncd]
cis_id: "2.3.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure systemd-timesyncd is enabled and running

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

systemd-timesyncd is a daemon that has been added for synchronizing the system clock across the network

## Rationale

systemd-timesyncd needs to be enabled and running in order to synchronize the system to a timeserver.

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations

## Audit

- IF - systemd-timesyncd is in use on the system, run the following commands:

Run the following command to verify that the systemd-timesyncd service is enabled:

### Command Line

```bash
# systemctl is-enabled systemd-timesyncd.service
```

**Output:**

```
enabled
```

Run the following command to verify that the systemd-timesyncd service is active:

```bash
# systemctl is-active systemd-timesyncd.service
```

**Output:**

```
active
```

## Remediation

- IF - systemd-timesyncd is in use on the system, run the following commands:

Run the following command to unmask systemd-timesyncd.service:

### Command Line

```bash
# systemctl unmask systemd-timesyncd.service
```

Run the following command to enable and start systemd-timesyncd.service:

```bash
# systemctl --now enable systemd-timesyncd.service
```

**- OR -**

If another time synchronization service is in use on the system, run the following command to stop and mask systemd-timesyncd:

```bash
# systemctl --now mask systemd-timesyncd.service
```

## References

1. NIST SP 800-53 Rev. 5: AU-7, AU-8

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.4 Standardize Time Synchronization<br/>Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported.                                                          |      | ●    | ●    |
| v7               | 6.1 Utilize Three Synchronized Time Sources<br/>Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. |      | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.001 | TA0002  | M1022       |
