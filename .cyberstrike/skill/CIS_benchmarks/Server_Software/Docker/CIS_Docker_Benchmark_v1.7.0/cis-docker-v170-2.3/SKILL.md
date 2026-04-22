---
name: cis-docker-v170-2.3
description: "Ensure the logging level is set to 'info'"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, logging, audit]
cis_id: "2.3"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.3

## Profile Applicability

- **Level:** 1 - Docker - Linux

## Description

Set Docker daemon log level to `info`.

## Rationale

Setting up an appropriate log level, configures the Docker daemon to log events that you would want to review later. A base log level of `info` and above would capture all logs except debug logs. Until and unless required, you should not run Docker daemon at `debug` log level.

## Impact

None.

## Audit Procedure

To confirm this setting a combination of reviewing the dockerd start-up options and a review of any settings in `/etc/docker/daemon.json` should be completed.

To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

Ensure that either the `--log-level` parameter is not present or if present, then it is set to `info`.

The contents of `/etc/docker/daemon.json` should also be reviewed for this setting.

## Remediation

Ensure that the Docker daemon configuration file has the following configuration included:

```json
"log-level": "info"
```

Alternatively, run the Docker daemon as below:

```bash
dockerd --log-level="info"
```

## Default Value

By default, Docker daemon is set to log level of `info`.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs<br/>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | ●    | ●    |
| v7               | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices.                                                                                                                                                                         | ●    | ●    | ●    |
| v7               | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.                                                                                |      | ●    | ●    |

## Profile

**Level 1 - Docker - Linux** (Manual)
