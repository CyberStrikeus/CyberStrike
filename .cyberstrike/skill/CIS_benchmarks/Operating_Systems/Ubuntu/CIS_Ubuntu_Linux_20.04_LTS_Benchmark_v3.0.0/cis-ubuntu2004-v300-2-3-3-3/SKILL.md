---
name: cis-ubuntu2004-v300-2-3-3-3
description: "Ensure chrony is enabled and running"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, chrony]
cis_id: "2.3.3.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure chrony is enabled and running

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

chrony is a daemon which implements the Network Time Protocol (NTP) and is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate.

chrony can be configured to be a client and/or a server.

More information on chrony can be found at: http://chrony.tuxfamily.org/.

**Note:**

- If systemd-timesyncd is being used, chrony should be removed and this section skipped
- Only one time synchronization method should be in use on the system

## Audit

- IF - chrony is in use on the system, run the following commands:

Run the following command to verify chrony is enabled:

### Command Line

```bash
# systemctl is-enabled chrony.service
```

**Output:**

```
enabled
```

Run the following command to verify chrony is running:

```bash
# systemctl is-active chrony.service
```

**Output:**

```
active
```

## Remediation

- IF - chrony is in use on the system, run the following commands:

Run the following command to unmask chrony.service:

### Command Line

```bash
# systemctl unmask chrony.service
```

Run the following command to enable and start chrony.service:

```bash
# systemctl --now enable chrony.service
```

**- OR -**

If another time synchronization service is in use on the system, run the following command to remove chrony from the system:

```bash
# apt purge chrony
# apt autoremove chrony
```

## References

1. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.4 Standardize Time Synchronization<br/>Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported. | | ● | ● |
| v7 | 6.1 Utilize Three Synchronized Time Sources<br/>Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1070, T1070.002, T1562, T1562.001 | TA0002 | M1022 |
