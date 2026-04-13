---
name: cis-docker-5.9
description: "Ensure that only needed ports are open on the container"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, networking, ports, security]
cis_id: "5.9"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.9 Ensure that only needed ports are open on the container (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

The dockerfile for a container image defines the ports which are opened by default on a container instance. The list of ports are relevant to the application you are running within the container and should only be open if they are needed.

## Rationale

A container can be run with only the ports defined in the Dockerfile for its image or can alternatively be arbitrarily passed at runtime parameter to open a list of ports. Additionally, in the course of time, the Dockerfile may undergo various changes and the list of exposed ports may or may not still be relevant to the application you are running within the container. Opening unneeded ports increases the attack surface of the container and the associated containerized application. Good security practice is to only open ports that are needed for the correct operation of the application.

## Impact

None.

## Audit Procedure

You should list all the running instances of containers and their associated port mappings by executing the command below:

```bash
docker ps --quiet | xargs docker inspect --format='{{ .Id }}: Ports={{ .NetworkSettings.Ports }}'
```

You should then review the list and ensure that all the ports mapped are in fact genuinely required by each container.

## Remediation

You should ensure that the Dockerfile for each container image only exposes needed ports. You can also completely ignore the list of ports defined in the Dockerfile by **NOT** using `-P` (UPPERCASE) or the `--publish-all` flag when starting the container. Instead, use the `-p` (lowercase) or `--publish` flag to explicitly define the ports that you need for a particular container instance.

For example:

```bash
docker run --interactive --tty --publish 5000 --publish 5001 --publish 5002 centos /bin/bash
```

## Default Value

By default, all the ports that are listed in the Dockerfile under the `EXPOSE` instruction for an image are opened when a container is run with the `-P` or `--publish-all` flags.

## References

1. https://docs.docker.com/engine/userguide/networking/

## CIS Controls

### v8

**13.9 Deploy Port-Level Access Control**

Deploy port-level access control. Port-level access control utilizes 802.1x, or similar network access control protocols, such as certificates, and may incorporate user and/or device authentication.

### v7

**9.2 Ensure Only Approved Ports, Protocols and Services Are Running**

Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.
