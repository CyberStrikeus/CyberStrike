---
name: cis-docker-1.1.11
description: "Ensure auditing is configured for Docker files and directories - /etc/docker/daemon.json"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, host-configuration, auditing]
cis_id: "1.1.11"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure auditing is configured for Docker files and directories - /etc/docker/daemon.json (Automated)

## Description

Audit `/etc/docker/daemon.json`, if applicable.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit all Docker related files and directories. The Docker daemon runs with `root` privileges and its behavior depends on some key files and directories. `/etc/docker/daemon.json` is one such file. This holds various parameters for the Docker daemon, and as such it should be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit

You should verify that there is an audit rule associated with the `/etc/docker/daemon.json` file.

For example, you could execute the command below:

```bash
auditctl -l | grep /etc/docker/daemon.json
```

This should display a rule for the `/etc/docker/daemon.json` file.

## Remediation

You should add a rule for the `/etc/docker/daemon.json` file.

For example:
Add the line below to the `/etc/audit/audit.rules` file:

```bash
-w /etc/docker/daemon.json -k docker
```

Then restart the audit daemon.
For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited. The file `/etc/docker/daemon.json` may not exist on the system and in that case, this recommendation is not applicable.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide
2. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-configuration-file

## CIS Controls

**Controls Version | Control | IG 1 | IG 2 | IG 3**

v8 | 8.5 Collect Detailed Audit Logs
Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ●

v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data
Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ●

## Profile

• Level 2 - Docker - Linux
