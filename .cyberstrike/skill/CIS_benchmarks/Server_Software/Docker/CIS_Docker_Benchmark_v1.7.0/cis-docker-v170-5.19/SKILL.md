---
name: cis-docker-v170-5.19
description: "Ensure that the default ulimit is overwritten at runtime if needed"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, ulimit, resources]
cis_id: "5.19"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.19

## Profile Applicability

- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

The default ulimit is set at the Docker daemon level. However, if you need to, you may override the default ulimit setting during container runtime.

## Rationale

`ulimit` provides control over the resources available to the shell and to processes started by it. Setting system resource limits in a prudent fashion, protects against denial of service conditions. On occasion, legitimate users and processes can accidentally overuse system resources and cause systems be degraded or even unresponsive.

The default ulimit set at the Docker daemon level should be honored. If the default ulimit settings are not appropriate for a particular container instance, you may override them as an exception, but this should not be done routinely. If many of your container instances are exceeding your ulimit settings, you should consider changing the default settings to something that is more appropriate for your needs.

## Impact

If ulimits are not set correctly, overutilization by individual containers could make the host system unusable.

## Audit Procedure

You should run the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: Ulimits={{ .HostConfig.Ulimits }}'
```

This command should return `Ulimits=<no value>` for each container instance unless there is a need in a specific case to override the default settings.

## Remediation

You should only override the default ulimit settings if needed in a specific case.

For example, to override the default ulimit settings start a container as below:

```bash
docker run -ti -d --ulimit nofile=1024:1024 centos sleep 1000
```

## Default Value

Container instances inherit the default ulimit settings set at the Docker daemon level.

## References

1. https://docs.docker.com/engine/reference/commandline/run/#set-ulimits-in-container---ulimit

## CIS Controls

**v8:**

- **3.12 Segment Data Processing and Storage Based on Sensitivity**
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**

- **5.2 Maintain Secure Images**
  - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.
