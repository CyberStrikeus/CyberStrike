---
name: cis-docker-v170-7.3
description: "Ensure that all Docker swarm overlay networks are encrypted"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, swarm, network, encryption]
cis_id: "7.3"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 7.3

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker Swarm

## Description

Ensure that all Docker swarm overlay networks are encrypted.

## Rationale

By default, data exchanged between containers on nodes on the overlay network is not encrypted. This could potentially expose traffic between containers.

## Impact

None

## Audit Procedure

You should run the command below to ensure that each overlay network has been encrypted.

```bash
docker network ls --filter driver=overlay --quiet | xargs docker network inspect --format '{{.Name}} {{ .Options }}'
```

## Remediation

You should create overlay networks the with `--opt encrypted` flag.

## Default Value

By default, data exchanged in overlay networks in Docker swarm mode is not encrypted.

## References

1. https://docs.docker.com/network/overlay/#encrypt-traffic-on-an-overlay-network

## CIS Controls

**v8:**
- **3.10 Encrypt Sensitive Data in Transit**
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**v7:**
- **14.4 Encrypt All Sensitive Information in Transit**
  - Encrypt all sensitive information in transit.
