---
name: cis-docker-v170-5.8
description: "Ensure privileged ports are not mapped within containers"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, ports]
cis_id: "5.8"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.8

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The TCP/IP port numbers below 1024 are considered privileged ports. Normal users and processes are not allowed to use them for various security reasons. Docker does, however allow a container port to be mapped to a privileged port.

## Rationale

By default, if the user does not specifically declare a container port to host port mapping, Docker automatically and correctly maps the container port to one available in the 49153-65535 range on the host. Docker does, however, allow a container port to be mapped to a privileged port on the host if the user explicitly declares it. This is because containers are executed with `NET_BIND_SERVICE` Linux kernel capability which does not restrict privileged port mapping. The privileged ports receive and transmit various pieces of data which are security sensitive and allowing containers to use them is not in line with good security practice.

## Impact

None.

## Audit Procedure

You can list all running containers instances and their port mappings by executing the command below:

```bash
docker ps --quiet | xargs docker inspect --format='{{ .Id }}: Ports={{ .NetworkSettings.Ports }}'
```

You should then review the list and ensure that container ports are not mapped to host port numbers below 1024.

## Remediation

You should not map container ports to privileged host ports when starting a container. You should also, ensure that there is no such container to host privileged port mapping declarations in the Dockerfile.

## Default Value

By default, mapping a container port to a privileged port on the host is allowed.

Note: There might be certain cases where you want to map privileged ports, because if you forbid it, then the corresponding application has to run outside of a container.

For example: HTTP and HTTPS load balancers have to bind 80/tcp and 443/tcp respectively. Forbidding to map privileged ports effectively forbids from running those in a container, and mandates using an external load balancer. In such cases, those containers instances should be marked as exceptions for this recommendation.

## References

1. https://docs.docker.com/network/

## CIS Controls

**v8:**

- 13.9 Deploy Port-Level Access Control - Deploy port-level access control. Port-level access control utilizes 802.1x, or similar network access control protocols, such as certificates, and may incorporate user and/or device authentication.

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Assessment Status

Manual
