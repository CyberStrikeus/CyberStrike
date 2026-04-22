---
name: cis-docker-v160-1.1.8
description: "Ensure auditing is configured for Docker files and directories - containerd.sock"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, auditing, logging, containerd, socket, linux]
cis_id: "1.1.8"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux, auditd, containerd]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.1.8

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Audit `containerd.sock`, if applicable.

## Rationale

As well as auditing the normal Linux file system and system calls, you should also audit the Docker daemon. Because this daemon runs with root privileges, it is very important to audit its activities and usage. Its behavior depends on some key files and directories with `containerd.sock` being one such file, and as this holds various parameters for the Docker daemon, it should be audited.

## Impact

Auditing can generate large log files. You should ensure that these are rotated and archived periodically. A separate partition should also be created for audit logs to avoid filling up any other critical partition.

## Audit Procedure

Step 1: Find out the file location:

```bash
grep 'containerd.sock' /etc/containerd/config.toml
```

or by checking the Docker `--containerd` option.

Step 2: If the file does not exist, this recommendation is not applicable. If the file exists, you should verify that there is an audit rule corresponding to the file:

For example, you could execute the command below:

```bash
auditctl -l | grep containerd.sock
```

This should display a rule for `containerd.sock`.

## Remediation

If the file exists, you should add a rule for it.

For example:
Add the line below to the `/etc/audit/audit.rules` file:

```bash
-w /run/containerd/containerd.sock -k docker
```

Then restart the audit daemon.

For example:

```bash
systemctl restart auditd
```

## Default Value

By default, Docker related files and directories are not audited. The file `containerd.sock` may not be present, but if it is, it should be audited.

## References

1. https://github.com/containerd/containerd/blob/master/docs/ops.md
2. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/system_design_guide/auditing-the-system_system-design-guide
3. https://docs.docker.com/engine/reference/commandline/dockerd/#docker-runtime-execution-options

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring). | | | ● |

## Assessment Status

Automated

## Additional Information

N/A
