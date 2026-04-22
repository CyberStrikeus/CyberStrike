---
name: cis-docker-v160-1.1.10
description: "Ensure auditing is configured for Docker files and directories - /etc/default/docker"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, logging, configuration, linux]
cis_id: "1.1.10"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux, auditd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.1.10

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Audit `/etc/default/docker`, if applicable.

## Rationale

As well as auditing the normal Linux file system and system calls, you should audit all Docker related files and directories. The Docker daemon runs with `root` privileges and its behavior depends on some key files and directories. `/etc/default/docker` is one such file. It holds various parameters related to the Docker daemon and should therefore be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

You should verify that there is an audit rule associated with the `/etc/default/docker` file.

For example, you could execute the command below:

```bash
auditctl -l | grep /etc/default/docker
```

This should display a rule for the `/etc/default/docker` file.

## Remediation

You should add a rule for the `/etc/default/docker` file.

For example:
Add the line below to the `/etc/audit/audit.rules` file:

```bash
-w /etc/default/docker -k docker
```

Then restart the audit daemon.

For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited so these defaults should be changed in line with organizational security policy. The file `/etc/default/docker` may not be present, and if so, this recommendation is not applicable.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ● |

## Assessment Status

Automated

## Additional Information

N/A
