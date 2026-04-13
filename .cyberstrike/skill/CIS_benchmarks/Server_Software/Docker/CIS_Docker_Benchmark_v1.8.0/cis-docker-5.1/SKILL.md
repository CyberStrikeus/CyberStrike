---
name: cis-docker-5.1
description: "Ensure swarm mode is not Enabled, if not needed"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, swarm, networking]
cis_id: "5.1"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1 Ensure swarm mode is not Enabled, if not needed (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

Do not enable swarm mode on a Docker engine instance unless this is needed.

## Rationale

By default, a Docker engine instance will not listen on any network ports, with all communications with the client coming over the Unix socket. When Docker swarm mode is enabled on a Docker engine instance, multiple network ports are opened on the system and made available to other systems on the network for the purposes of cluster management and node communications.

Opening network ports on a system increases its attack surface and this should be avoided unless required.

It should be noted that swarm mode is required for the operation of Docker Enterprise components.

## Impact

Disabling swarm mode will impact the operation of Docker Enterprise components if these are in use.

## Audit Procedure

Review the output of

```bash
docker info --format '{{ .Swarm }}'
```

If the output includes `active true` it indicates that swarm mode has been activated on the Docker engine. In this case, you should confirm if swarm mode on the Docker engine instance is actually needed.

## Remediation

If swarm mode has been enabled on a system in error, you should run the command below:

```bash
docker swarm leave
```

## Default Value

By default, Docker swarm mode is not enabled.

## References

1. https://docs.docker.com/engine/reference/commandline/swarm_leave/

## CIS Controls

### v8

**4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software**

Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

### v7

**9.2 Ensure Only Approved Ports, Protocols and Services Are Running**

Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.
