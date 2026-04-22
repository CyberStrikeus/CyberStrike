---
name: cis-docker-v170-5.10
description: "Ensure that the host's network namespace is not shared"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, network-namespace]
cis_id: "5.10"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.10

## Profile Applicability

- Level 1 - Docker - Linux

## Description

When the networking mode on a container is set to `--net=host`, the container is not placed inside a separate network stack. Effectively, applying this option instructs Docker to not containerize the container's networking. The consequence of this is that the container lives "outside" in the main Docker host and has full access to its network interfaces.

## Rationale

Selecting this option is potentially dangerous. It allows the container process to open reserved low numbered ports in the way that any other root process can. It also allows the container to access network services such as D-bus on the Docker host. A container process could potentially carry out undesired actions, such as shutting down the Docker host. This option should not be used unless there is a very specific reason for enabling it.

## Impact

None.

## Audit Procedure

You should use the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: NetworkMode={{ .HostConfig.NetworkMode }}'
```

If this returns `NetworkMode=host`, it means that the `--net=host` option was passed when the container was started.

## Remediation

You should not pass the `--net=host` option when starting any container.

## Default Value

By default, containers connect to the Docker `bridge` when starting and do not run in the context of the host's network stack.

## References

1. https://docs.docker.com/network/
2. https://docs.docker.com/engine/reference/run/#network-settings

## CIS Controls

**v8:**

- 12.2 Establish and Maintain a Secure Network Architecture - Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum.

**v7:**

- 12 Boundary Defense - Boundary Defense

## Assessment Status

Manual
