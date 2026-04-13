---
name: cis-docker-7.4
description: "Ensure that Docker's secret management commands are used for managing secrets in a swarm cluster"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, swarm, orchestration, secrets]
cis_id: "7.4"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4 Ensure that Docker's secret management commands are used for managing secrets in a swarm cluster (Manual)

## Profile Applicability

- Level 1 - Docker Swarm

## Description

You should use Docker's in-built secret management command for control of secrets.

## Rationale

Docker has various commands for managing secrets in a swarm cluster.

## Impact

None

## Audit Procedure

On a swarm manager node, you should run the command below and ensure `docker secret` management is used in your environment where this is in line with your IT security policy.

```
docker secret ls
```

## Remediation

You should follow the `docker secret` documentation and use it to manage secrets effectively.

## Default Value

Not Applicable

## References

1. https://docs.docker.com/engine/reference/commandline/secret/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). | | | |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |
