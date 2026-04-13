---
name: cis-docker-v170-1.1.6
description: "Ensure auditing is configured for Docker files and directories - /etc/docker"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, filesystem]
cis_id: "1.1.6"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker, linux, auditd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 1.1.6

## Profile
- **Level:** 1 - Docker - Linux
- **Assessment Status:** Automated

## Description

Audit `/etc/docker`.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit all Docker related files and directories. The Docker daemon runs with `root` privilege and its behavior depends on some key files and directories, one of these being `/etc/docker`. This holds various certificates and keys used for TLS communication between Docker daemon and Docker client and as such it should be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

You should verify that there is an audit rule applied to the `/etc/docker` directory.
For example, you could execute the command below:

```bash
auditctl -l | grep /etc/docker
```

This should display a rule for the `/etc/docker` directory.

## Remediation

You should add a rule for the `/etc/docker` directory.
For example:
Add the line below to the `/etc/audit/rules.d/audit.rules` file:

```bash
-w /etc/docker -k docker
```

Then restart the audit daemon. For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br/>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br/>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ● |
