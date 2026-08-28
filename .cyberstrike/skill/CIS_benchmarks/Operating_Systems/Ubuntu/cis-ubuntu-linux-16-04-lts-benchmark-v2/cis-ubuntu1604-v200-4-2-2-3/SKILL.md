---
name: cis-ubuntu1604-v200-4-2-2-3
description: "Ensure journald is configured to write logfiles to persistent disk"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.2.3

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Data from journald may be stored in volatile memory or persisted locally on the server. Logs in memory will be lost upon a system reboot. By persisting logs to local disk on the server they are protected from loss.

**Note:** The main configuration file `/etc/systemd/journald.conf` is read before any of the custom \*.conf files. If there are custom configs present, they override the main configuration parameters.

## Rationale

Writing log data to disk will provide the ability to forensically reconstruct events which may have impacted the operations or security of a system even after a system crash or reboot.

## Impact

None.

## Audit Procedure

Review `/etc/systemd/journald.conf` and verify that logs are persisted to disk:

### Command Line

```bash
grep -e Storage /etc/systemd/journald.conf
```

## Expected Result

```
Storage=persistent
```

## Remediation

Edit the `/etc/systemd/journald.conf` file and add the following line:

### Command Line

```bash
# Add or update the following in /etc/systemd/journald.conf:
Storage=persistent
```

## Default Value

Storage is set to `auto` by default, which means journal data is stored in `/var/log/journal/` if the directory exists.

## References

1. https://github.com/konstruktoid/hardening/blob/master/systemd.adoc#etcsystemdjournaldconf

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |      |      |      |
| v7               | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |      |      |      |
