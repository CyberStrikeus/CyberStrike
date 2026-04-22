---
name: cis-docker-v160-1.1.3
description: "Ensure auditing is configured for the Docker daemon"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, logging, linux]
cis_id: "1.1.3"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux, auditd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.1.3

## Profile Applicability

- Level 1 - Docker - Linux
- Level 2 - Docker - Linux

## Description

Audit all Docker daemon activities.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit the Docker daemon. Because this daemon runs with `root` privileges. It is very important to audit its activities and usage.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

Verify that there are audit rules for the Docker daemon. For example, you could execute the following command:

```bash
auditctl -l | grep /usr/bin/dockerd
```

This should show the rules associated with the Docker daemon.

## Remediation

You should add rules for the Docker daemon.

For example:
Add the line below to the `/etc/audit/rules.d/audit.rules` file:

```bash
-w /usr/bin/dockerd -k docker
```

Then, restart the audit daemon using the following command

```bash
systemctl restart auditd
```

## Default Value

By default, the Docker daemon is not audited.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs<br>Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                         | ●    | ●    | ●    |
| v7               | 6.2 Activate audit logging<br>Ensure that local logging has been enabled on all systems and networking devices.                                                                                          | ●    | ●    | ●    |
| v7               | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |      | ●    | ●    |

## Assessment Status

Automated

## Additional Information

N/A
