---
name: cis-docker-1.1.5
description: "Ensure auditing is configured for Docker files and directories - /var/lib/docker"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, host-configuration, auditing]
cis_id: "1.1.5"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure auditing is configured for Docker files and directories - /var/lib/docker (Manual)

## Description

Audit `/var/lib/docker` or data-root.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit all Docker related files and directories. The Docker daemon runs with `root` privileges and its behaviour depends on some key files and directories. `/var/lib/docker` is one such directory. As it holds all the information about containers it should be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit

You should verify that there is an audit rule applied to the `/var/lib/docker` directory or whatever your data-root directory is set to.

You can configure the Docker daemon to use a different directory, using the data-root configuration option. For example:

```json
{
  "data-root": "/mnt/docker-data"
}
```

To perform an audit execute the command below:

```bash
auditctl -l | grep /var/lib/docker
```

or

```bash
auditctl -l | grep data-root
```

This should list a rule for the `/var/lib/docker` directory.

## Remediation

You should add a rule for the `/var/lib/docker` directory.

Adding exclusions for /var/lib/docker/overlay2 & /var/lib/docker/volumes reduces the audit messages to a more manageable level.

For example,
Add the line as below to the `/etc/audit/rules.d/audit.rules` file:

```bash
-a exit,always -F path=/var/lib/docker -F perm=war -k docker
-a exit,never -F dir=/var/lib/docker/volumes
-a exit,never -F dir=/var/lib/docker/overlay2
```

or for systems with namespace-remapping enabled

```bash
-a exit,always -F path=/var/lib/docker -F perm=war -k docker
-a exit,never -F dir=/var/lib/165536.165536/volumes
-a exit,never -F dir=/var/lib/docker/165536.165536/overlay2
```

Then, restart the audit daemon using the following command

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited.

## References

1. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide
2. https://docs.docker.com/engine/daemon/#daemon-data-directory

## CIS Controls

**Controls Version | Control | IG 1 | IG 2 | IG 3**

v8 | 8.5 Collect Detailed Audit Logs
Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ●

v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data
Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ●

## Profile

• Level 1 - Docker - Linux
