---
name: cis-docker-5.19
description: "Ensure that the default ulimit is overwritten at runtime if needed"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, ulimit, cgroup]
cis_id: "5.19"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.19 Ensure that the default ulimit is overwritten at runtime if needed (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The default ulimit is set at the Docker daemon level. However, if you need to, you may override the default ulimit setting during container runtime.

## Rationale

`ulimit` provides control over the resources available to the shell and to processes started by it. Setting system resource limits in a prudent fashion, protects against denial of service conditions. On occasion, legitimate users and processes can accidentally overuse system resources and cause systems be degraded or even unresponsive.

The default ulimit set at the Docker daemon level should be honored. If the default ulimit settings are not appropriate for a particular container instance, you may override them as an exception, but this should not be done routinely. If many of your container instances are exceeding your ulimit settings, you should consider changing the default settings to something that is more appropriate for your needs.

## Impact

If ulimits are not set correctly, overutilization by individual containers could make the host system unusable.

## Audit Procedure

You should run the command below:

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: Ulimits={{ .HostConfig.Ulimits }}'
```

This command should return `Ulimits=<no value>` for each container instance unless there is a need in a specific case to override the default settings.

## Remediation

You should only override the default ulimit settings if needed in a specific case. For example, to override the default ulimit settings start a container as below:

```
docker run -ti -d --ulimit nofile=1024:1024 centos sleep 1000
```

## Default Value

Container instances inherit the default ulimit settings set at the Docker daemon level.

## References

1. https://docs.docker.com/engine/reference/commandline/run/#set-ulimits-in-container---ulimit

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.12 Segment Data Processing and Storage Based on Sensitivity<br>Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.                                                               |      | ●    | ●    |
| v7               | 5.2 Maintain Secure Images<br>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. |      | ●    | ●    |
