---
name: cis-docker-v160-1.1.7
description: "Ensure auditing is configured for Docker files and directories - docker.service"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, logging, systemd, linux]
cis_id: "1.1.7"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux, auditd, systemd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.1.7

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Audit the `docker.service` if applicable.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit all Docker related files and directories. The Docker daemon runs with `root` privileges and its behavior depends on some key files and directories with `docker.service` being one such file. The `docker.service` file might be present if the daemon parameters have been changed by an administrator. If so, it holds various parameters for the Docker daemon and as such it should be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

Step 1: Find out the file location:

```bash
systemctl show -p FragmentPath docker.service
```

Step 2: If the file does not exist, this recommendation does not apply. If the file does exist, verify that there is an audit rule corresponding to the file:

For example, you could execute the command below:

```bash
auditctl -l | grep docker.service
```

This should display a rule for `docker.service`.

## Remediation

If the file exists, a rule for it should be added.

For example:
Add the line as below in `/etc/audit/audit.rules` file:

```bash
-w /usr/lib/systemd/system/docker.service -k docker
```

Then restart the audit daemon.

For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited. The file `docker.service` may not be present on the system.

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
