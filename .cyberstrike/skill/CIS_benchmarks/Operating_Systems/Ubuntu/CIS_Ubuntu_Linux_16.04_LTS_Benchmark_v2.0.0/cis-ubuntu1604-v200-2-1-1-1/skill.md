---
name: cis-ubuntu1604-v200-2-1-1-1
description: "Ensure time synchronization is in use"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.1 Ensure time synchronization is in use (Automated)

## Description

System time should be synchronized between all systems in an environment. This is typically done by establishing an authoritative time server or set of servers and having all systems synchronize their clocks to them.

Notes:

- If access to a physical host's clock is available and configured according to site policy, this section can be skipped
- Only one time synchronization method should be in use on the system
- Only the section related to the time synchronization method in use on the system should be followed, all other time synchronization recommendations should be skipped
- If access to a physical host's clock is available and configured according to site policy, systemd-timesyncd should be stopped and masked

## Rationale

Time synchronization is important to support time sensitive security mechanisms like Kerberos and also ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit Procedure

### Command Line

On physical systems or virtual systems where host based time synchronization is not available verify that timesyncd, chrony, or NTP is installed. Use one of the following commands to determine the needed information:

If systemd-timesyncd is used:

```bash
systemctl is-enabled systemd-timesyncd
```

If chrony is used:

```bash
dpkg -s chrony
```

If ntp is used:

```bash
dpkg -s ntp
```

On virtual systems where host based time synchronization is available consult your virtualization software documentation and verify that host based synchronization is in use.

## Expected Result

One of the time synchronization services (systemd-timesyncd, chrony, or ntp) should be installed and enabled.

## Remediation

### Command Line

On systems where host based time synchronization is not available, configure systemd-timesyncd. If "full featured" and/or encrypted time synchronization is required, install chrony or NTP.

To install chrony:

```bash
apt install chrony
```

To install ntp:

```bash
apt install ntp
```

On virtual systems where host based time synchronization is available consult your virtualization software documentation and setup host based synchronization.

## Default Value

Time synchronization is not configured by default.

## References

1. CIS Controls v7 - 6.1 Utilize Three Synchronized Time Sources

## Profile

- Level 1 - Server
- Level 1 - Workstation
