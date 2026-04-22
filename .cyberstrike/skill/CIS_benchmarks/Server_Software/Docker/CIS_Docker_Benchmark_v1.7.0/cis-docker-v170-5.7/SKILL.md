---
name: cis-docker-v170-5.7
description: "Ensure sshd is not run within containers"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, ssh]
cis_id: "5.7"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.7

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The SSH daemon should not be running within the container. You should SSH into the Docker host, and use `docker exec` to enter a container.

## Rationale

Running SSH within the container increases the complexity of security management by making it

- Difficult to manage access policies and security compliance for SSH server
- Difficult to manage keys and passwords across various containers
- Difficult to manage security upgrades for SSH server

It is possible to have shell access to a container without using SSH, the needlessly increasing the complexity of security management should be avoided.

## Impact

None.

## Audit Procedure

List all the running instances of containers by executing below command:

```bash
docker ps --quiet
```

For each container instance, execute the below command:

```bash
docker exec <CONTAINER_ID> ps -el
```

Ensure that there is no process for SSH server.

## Remediation

Uninstall the SSH daemon from the container and use and use `docker exec` to enter a container on the remote host.

```bash
docker exec --interactive --tty <CONTAINER_ID> sh
```

OR

```bash
docker attach <CONTAINER_ID>
```

## Default Value

By default, SSH server is not running inside the container. Only one process per container is allowed.

## References

1. https://jpetazzo.github.io/2014/06/23/docker-ssh-considered-evil/

## CIS Controls

**v8:**

- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Assessment Status

Manual
