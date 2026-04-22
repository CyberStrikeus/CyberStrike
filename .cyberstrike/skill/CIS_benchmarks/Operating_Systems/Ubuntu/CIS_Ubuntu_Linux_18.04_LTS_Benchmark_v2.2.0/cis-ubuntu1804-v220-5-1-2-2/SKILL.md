---
name: cis-ubuntu1804-v220-5-1-2-2
description: "Ensure rsyslog service is enabled"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, rsyslog, logging]
cis_id: "5.1.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2.2 Ensure rsyslog service is enabled (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Once the `rsyslog` package is installed, ensure that the service is enabled.

## Rationale

If the `rsyslog` service is not enabled to start on boot, the system will not capture logging events.

## Audit Procedure

### Command Line

Run the following command to verify `rsyslog` is enabled:

```bash
systemctl is-enabled rsyslog
```

Verify the output matches:

```
enabled
```

## Expected Result

The output should show `enabled`.

## Remediation

### Command Line

Run the following command to enable `rsyslog`:

```bash
systemctl --now enable rsyslog
```

## Default Value

enabled (when installed)

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                         |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
