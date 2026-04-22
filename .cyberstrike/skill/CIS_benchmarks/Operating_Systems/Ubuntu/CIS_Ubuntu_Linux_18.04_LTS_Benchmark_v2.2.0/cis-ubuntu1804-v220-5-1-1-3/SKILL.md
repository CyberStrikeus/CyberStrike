---
name: cis-ubuntu1804-v220-5-1-1-3
description: "Ensure journald is configured to compress large log files"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.3 Ensure journald is configured to compress large log files (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The journald system includes the capability of compressing overly large files to avoid filling up the system with logs or making the logs unmanageably large.

## Rationale

Uncompressed large files may unexpectedly fill a filesystem leading to resource unavailability. Compressing logs prior to write can prevent sudden, unexpected filesystem impacts.

## Audit Procedure

### Command Line

Run the following command to verify that large files will be compressed:

```bash
grep -Psi '^\h*Compress\h*=\h*yes\b' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*
```

Verify the output matches:

```
Compress=yes
```

## Expected Result

The output should include `Compress=yes`.

## Remediation

### Command Line

Edit the `/etc/systemd/journald.conf` file or a file ending in .conf in /etc/systemd/journald.conf.d/ and add the following line:

```
Compress=yes
```

Restart the service:

```bash
systemctl restart systemd-journald
```

## Default Value

Compress=yes

## References

1. NIST SP 800-53 Rev. 5: AU-4

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                         |
| v8               | 8.3 Ensure Adequate Audit Log Storage - Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.                                        |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
| v7               | 6.4 Ensure adequate storage for logs - Ensure that all systems that store logs have adequate storage space for the logs generated.                                                                      |
