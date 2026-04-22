---
name: cis-docker-v170-5.30
description: "Ensure that Docker's default bridge docker0 is not used"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, network, bridge]
cis_id: "5.30"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.30

## Profile Applicability

- **Level:** 2
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

You should not use Docker's default bridge `docker0`. Instead you should use Docker's user-defined networks for container networking.

## Rationale

Docker connects virtual interfaces created in bridge mode to a common bridge called `docker0`. This default networking model is vulnerable to ARP spoofing and MAC flooding attacks as there is no filtering applied to it.

## Impact

User-defined networks need to be configured and managed in line with organizational security policy.

## Audit Procedure

You should run the command below, and verify that containers are on a user-defined network and not the default `docker0` bridge.

```bash
docker network ls --quiet | xargs docker network inspect --format '{{ .Name }}: {{ .Options }}'
```

## Remediation

You should follow the Docker documentation and set up a user-defined network. All the containers should be run in this network.

## Default Value

By default, Docker runs containers within the default `docker0` bridge.

## References

1. https://docs.docker.com/network/bridge/

## CIS Controls

**v8:**

- **4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software**
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v6:**

- **9 Limitation and Control of Network Ports, Protocols, and Services**
  - Limitation and Control of Network Ports, Protocols, and Services
