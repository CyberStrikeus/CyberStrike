---
name: cis-ubuntu1604-v200-4-2-2-1
description: "Ensure journald is configured to send logs to rsyslog"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.2.1

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Data from journald may be stored in volatile memory or persisted locally on the server. Utilities exist to accept remote export of journald logs, however, use of the rsyslog service provides a consistent means of log collection and export.

**Notes:**

- This recommendation assumes that recommendation 4.2.1.5, "Ensure rsyslog is configured to send logs to a remote log host" has been implemented.
- As noted in the journald man pages, journald logs may be exported to rsyslog either through the process mentioned here, or through a facility like `systemd-journald.service`. There are trade-offs involved in each implementation, where `ForwardToSyslog` will immediately capture all events (and forward to an external log server, if properly configured), but may not capture all boot-up activities. Mechanisms such as `systemd-journald.service`, on the other hand, will record bootup events, but may delay sending the information to rsyslog, leading to the potential for log manipulation prior to export. Be aware of the limitations of all tools employed to secure a system.
- The main configuration file `/etc/systemd/journald.conf` is read before any of the custom \*.conf files. If there are custom configs present, they override the main configuration parameters.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Impact

None.

## Audit Procedure

Review `/etc/systemd/journald.conf` and verify that logs are forwarded to syslog.

### Command Line

```bash
grep -e ForwardToSyslog /etc/systemd/journald.conf
```

## Expected Result

```
ForwardToSyslog=yes
```

## Remediation

Edit the `/etc/systemd/journald.conf` file and add the following line:

### Command Line

```bash
# Add or update the following in /etc/systemd/journald.conf:
ForwardToSyslog=yes
```

## Default Value

ForwardToSyslog is not set by default.

## References

1. https://github.com/konstruktoid/hardening/blob/master/systemd.adoc#etcsaborystemdjournaldconf

## CIS Controls

| Controls Version | Control                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 6.5 Central Log Management<br/>Ensure that appropriate logs are being aggregated to a central log management system for analysis and review. |      |      |      |
