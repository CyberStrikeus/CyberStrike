---
name: cis-docker-v170-4.6
description: "Ensure that HEALTHCHECK instructions have been added to container images"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, availability]
cis_id: "4.6"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.6

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should add the `HEALTHCHECK` instruction to your Docker container images in order to ensure that health checks are executed against running containers.

## Rationale

An important security control is that of availability. Adding the `HEALTHCHECK` instruction to your container image ensures that the Docker engine periodically checks the running container instances against that instruction to ensure that containers are still operational.

Based on the results of the health check, the Docker engine could terminate containers which are not responding correctly, and instantiate new ones.

## Impact

None.

## Audit Procedure

You should run the command below to ensure that Docker images have the appropriate `HEALTHCHECK` instruction configured.

```bash
docker inspect --format='{{ .Config.Healthcheck }}' <IMAGE>
```

## Remediation

You should follow the Docker documentation and rebuild your container images to include the `HEALTHCHECK` instruction.

## Default Value

By default, `HEALTHCHECK` is not set.

## References

1. https://docs.docker.com/engine/reference/builder/#healthcheck

## CIS Controls

**v8:**

- 16.12 Implement Code-Level Security Checks - Apply static and dynamic analysis tools within the application life cycle to verify that secure coding practices are being followed.

**v7:**

- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status

Manual
