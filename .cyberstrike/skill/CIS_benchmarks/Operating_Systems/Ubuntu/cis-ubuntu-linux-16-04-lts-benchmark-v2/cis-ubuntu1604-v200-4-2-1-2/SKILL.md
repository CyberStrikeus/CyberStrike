---
name: cis-ubuntu1604-v200-4-2-1-2
description: "Ensure rsyslog Service is enabled"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.2

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Once the `rsyslog` package is installed it needs to be activated.

## Rationale

If the `rsyslog` service is not activated the system may default to the `syslogd` service or lack logging instead.

## Impact

None.

## Audit Procedure

Run one of the following commands to verify `rsyslog` is enabled:

### Command Line

```bash
systemctl is-enabled rsyslog
```

## Expected Result

Verify result is `enabled`.

## Remediation

Run the following commands to enable `rsyslog`:

### Command Line

```bash
systemctl --now enable rsyslog
```

## Additional Information

Additional methods of enabling a service exist. Consult your distribution documentation for appropriate methods.

## Default Value

rsyslog is enabled by default on Ubuntu 16.04.

## References

None.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |      |      |      |
| v7               | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |      |      |      |
