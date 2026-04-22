---
name: cis-ubuntu1804-v220-5-1-1-4
description: "Ensure journald is configured to write logfiles to persistent disk"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.4 Ensure journald is configured to write logfiles to persistent disk (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Data from journald may be stored in volatile memory or persisted locally on the server. Logs in memory will be lost upon a system reboot. By persisting logs to local disk on the server they are protected from loss due to a reboot.

## Rationale

Writing log data to disk will provide the ability to forensically reconstruct events which may have impacted the operations or security of a system even after a system crash or reboot.

## Audit Procedure

### Command Line

Run the following command to verify that logs are persisted to disk:

```bash
grep -Psi '^\h*Storage\h*=\h*persistent\b' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*
```

Verify the output matches:

```
Storage=persistent
```

## Expected Result

The output should include `Storage=persistent`.

## Remediation

### Command Line

Edit the `/etc/systemd/journald.conf` file or a file ending in `.conf` in /etc/systemd/journald.conf.d/ and add the following line:

```
Storage=persistent
```

Restart the service:

```bash
systemctl restart systemd-journald
```

## Default Value

Storage=auto

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
