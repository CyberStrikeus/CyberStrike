---
name: cis-ubuntu1804-v220-5-1-1-2
description: "Ensure journald service is enabled"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.2 Ensure journald service is enabled (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Ensure that the `systemd-journald` service is enabled to allow capturing of logging events.

## Rationale

If the `systemd-journald` service is not enabled to start on boot, the system will not capture logging events.

## Audit Procedure

### Command Line

Run the following command to verify `systemd-journald` is enabled:

```bash
systemctl is-enabled systemd-journald.service
```

Verify the output matches:

```
static
```

## Expected Result

The output should show `static`.

## Remediation

### Command Line

By default the `systemd-journald` service does not have an `[Install]` section and thus cannot be enabled / disabled. It is meant to be referenced as `Requires` or `Wants` by other unit files. As such, if the status of `systemd-journald` is not `static`, investigate why.

## Default Value

static

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-7, AU-12

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
