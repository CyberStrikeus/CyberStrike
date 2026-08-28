---
name: cis-gcp-cos-2.1.1.2
description: "Ensure chrony is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, time-synchronization, chrony, ntp, services]
cis_id: "2.1.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.2 Ensure chrony is configured (Automated)

## Description

chrony is a daemon which implements the Network Time Protocol (NTP) is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate. More information on chrony can be found at http://chrony.tuxfamily.org/. chrony can be configured to be a client and/or a server.

## Rationale

If chrony is in use on the system proper configuration is vital to ensuring time synchronization is working properly.

This recommendation only applies if chrony is in use on the system.

## Audit Procedure

Run the following command and verify remote server is configured properly:

```bash
# grep -E "^(server|pool)" /etc/chrony/chrony.conf
server <remote-server>
```

Multiple servers may be configured.

Run the following command and verify the first field for the `chronyd` process is `ntp` or `chrony`:

```bash
# ps -ef | grep chronyd
ntp       491     1  0 20:32 ?        00:00:00 /usr/sbin/chronyd
```

Or

```bash
# ps -ef | grep chronyd
chrony    491     1  0 20:32 ?        00:00:00 /usr/sbin/chronyd
```

## Expected Result

The `grep` command should return a configured server or pool entry. The `ps` command should show `chronyd` running under the `ntp` or `chrony` user.

## Remediation

Update to an OS image that has the correct chrony configuration.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **8.4 Standardize Time Synchronization** - Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported.                                                          |      | X    | X    |
| v7               | **6.1 Utilize Three Synchronized Time Sources** - Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. |      | X    | X    |

## Profile

- Level 2 - Server
