---
name: cis-docker-v160-1.1.13
description: "Ensure auditing is configured for Docker files and directories - /etc/sysconfig/docker"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, logging, configuration, sysconfig, linux]
cis_id: "1.1.13"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux, auditd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.1.13

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Audit `/etc/sysconfig/docker` if applicable

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit the Docker daemon. Because this daemon runs with root privileges it is very important to audit its activities and usage. Its behavior depends on some key files and directories and `/etc/sysconfig/docker` is one such file as it contains various parameters related to the Docker daemon when run on CentOS and RHEL based distributions. If present, it is important that it is audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

You should verify that there is an audit rule present relating to the `/etc/sysconfig/docker` file.

For example, you could execute the command below:

```bash
auditctl -l | grep /etc/sysconfig/docker
```

This should display a rule for `/etc/sysconfig/docker` file.

## Remediation

You should add a rule for `/etc/sysconfig/docker` file.

For example:
Add the line below to the `/etc/audit/audit.rules` file:

```bash
-w /etc/sysconfig/docker -k docker
```

Then restart the audit daemon.

For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited. The file `/etc/sysconfig/docker` may not be presemt on the system and in that case, this recommendation is not applicable.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | ●    | ●    |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring).                       |      |      | ●    |

## Assessment Status

Automated

## Additional Information

N/A
