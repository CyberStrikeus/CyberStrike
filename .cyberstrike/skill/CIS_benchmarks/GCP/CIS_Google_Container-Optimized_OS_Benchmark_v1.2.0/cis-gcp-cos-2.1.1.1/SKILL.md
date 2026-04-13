---
name: cis-gcp-cos-2.1.1.1
description: "Ensure time synchronization is in use"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, time-synchronization, chrony, ntp, services]
cis_id: "2.1.1.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.1 Ensure time synchronization is in use (Manual)

## Description

System time should be synchronized between all systems in an environment. This is typically done by establishing an authoritative time server or set of servers and having all systems synchronize their clocks to them.

## Rationale

Time synchronization is important to support time sensitive security mechanisms like Kerberos and also ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit Procedure

On physical systems or virtual systems where host based time synchronization is not available verify that chrony is installed with the following command:

```bash
# grep '\"name\": \"chrony\"' /etc/cos-package-info.json

"name": "chrony",
```

On virtual systems where host based time synchronization is available consult your virtualization software documentation and verify that host based synchronization is in use.

## Expected Result

The command should return `"name": "chrony",` confirming chrony is installed. On virtual systems with host-based time synchronization, verify that host-based synchronization is active.

## Remediation

On physical systems or virtual systems where host based time synchronization is not available update to an image that comes with chrony package installed.
On virtual systems where host based time synchronization is available consult your virtualization software documentation and setup host based synchronization.

**Additional Information:**

systemd-timesyncd is part of systemd. Some versions of systemd have been compiled without systemd-timesycnd. On these distributions, chrony or NTP should be used instead of systemd-timesycnd.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **8.4 Standardize Time Synchronization** - Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported. | | X | X |
| v7 | **6.1 Utilize Three Synchronized Time Sources** - Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. | | X | X |

## Profile

- Level 1 - Server
