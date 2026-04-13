---
name: cis-docker-v170-1.1.12
description: "Ensure auditing is configured for Docker files and directories - /etc/containerd/config.toml"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, containerd, level-2]
cis_id: "1.1.12"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker, linux, auditd, containerd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 1.1.12

## Profile
- **Level:** 2 - Docker - Linux
- **Assessment Status:** Automated

## Description

Audit `/etc/containerd/config.toml` if applicable

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit the Docker daemon. Because this daemon runs with root privileges it is very important to audit its activities and usage. Its behavior depends on some key files and directories and `/etc/containerd/config.toml` is one such file as it contains various parameters. If present, it is important that it is audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

You should verify that there is an audit rule present relating to the `/etc/containerd/config.toml` file.
For example, you could execute the command below:

```bash
auditctl -l | grep /etc/containerd/config.toml
```

This should display a rule for `/etc/containerd/config.toml` file.

## Remediation

You should add a rule for `/etc/containerd/config.toml` file.
For example:
Add the line below to the `/etc/audit/audit.rules` file:

```bash
-w /etc/containerd/config.toml -k docker
```

Then restart the audit daemon.
For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited. The file `/etc/containerd/config.toml` may not be present on the system and in that case, this recommendation is not applicable.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br/>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br/>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ● |
