---
name: cis-ubuntu1804-v220-5-1-1-1-3
description: "Ensure systemd-journal-remote is enabled"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.1.3 Ensure systemd-journal-remote is enabled (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

Journald (via `systemd-journal-remote`) supports the ability to send log events it gathers to a remote log host or to receive messages from remote hosts, thus enabling centralised log management.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Audit Procedure

### Command Line

Verify `systemd-journal-remote` is enabled. Run the following command:

```bash
systemctl is-enabled systemd-journal-upload.service
```

Verify the output matches:

```
enabled
```

## Expected Result

The output should show `enabled`.

## Remediation

### Command Line

Run the following command to enable `systemd-journal-remote`:

```bash
systemctl --now enable systemd-journal-upload.service
```

## Default Value

systemd-journal-upload.service is not enabled by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-12, CM-7, SI-5

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
