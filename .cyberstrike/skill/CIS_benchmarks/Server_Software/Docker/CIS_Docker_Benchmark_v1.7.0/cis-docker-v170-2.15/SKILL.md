---
name: cis-docker-v170-2.15
description: "Ensure live restore is enabled"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, live-restore, availability]
cis_id: "2.15"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.15

## Profile Applicability

- **Level:** 1 - Docker - Linux

## Description

The `--live-restore` option enables full support of daemon-less containers within Docker. It ensures that Docker does not stop containers on shutdown or restore and that it properly reconnects to the container when restarted.

## Rationale

One of the important security triads is availability. Setting the `--live-restore` flag within the Docker daemon ensures that container execution is not interrupted when it is not available. This also makes it easier to update and patch the Docker daemon without application downtime.

## Impact

None.

## Audit Procedure

You should run `docker info` and ensure that the `Live Restore Enabled` property is set to `true`.

```bash
docker info --format '{{ .LiveRestoreEnabled }}'
```

Alternatively, you could run the below command and ensure that `--live-restore` is in use.

```bash
ps -ef | grep dockerd
```

The contents of `/etc/docker/daemon.json` should also be reviewed to ensure this setting is in place.

## Remediation

Run Docker in daemon mode and pass `--live-restore` to it as an argument.

For Example,

```bash
dockerd --live-restore
```

## Default Value

By default, `--live-restore` is not enabled.

## References

1. https://docs.docker.com/config/containers/live-restore/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.10 Apply Secure Design Principles in Application Architectures<br/>Apply secure design principles in application architectures. Secure design principles include the concept of least privilege and enforcing mediation to validate every operation that the user makes, requesting that the user accept an action before it takes place, or "never trust user input." Examples include ensuring that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats. Secure design also means minimizing the application infrastructure attack surface, such as turning off unprotected ports and services, removing unnecessary programs and files, and renaming or removing default accounts. |      | ●    | ●    |
| v7               | 18 Application Software Security<br/>Application Software Security                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |      |      |      |

## Profile

**Level 1 - Docker - Linux** (Manual)
