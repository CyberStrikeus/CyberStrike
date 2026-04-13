---
name: cis-docker-v170-5.27
description: "Ensure that container health is checked at runtime"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, healthcheck, monitoring]
cis_id: "5.27"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.27

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

If the container image does not have an `HEALTHCHECK` instruction defined, you should use the `--health-cmd` parameter at container runtime to check container health.

## Rationale

If the container image you are using does not have a pre-defined `HEALTHCHECK` instruction, use the `--health-cmd` parameter to check container health at runtime.

Based on the reported health status, remedial actions can be taken if necessary.

## Impact

None.

## Audit Procedure

You should run the command below and ensure that all containers are reporting their health status:

```bash
docker ps --quiet | xargs docker inspect --format '{{ .Id }}: Health={{ .State.Health.Status }}'
```

## Remediation

You should run the container using the `--health-cmd` parameter.

For example:

```bash
docker run -d --health-cmd='stat /etc/passwd || exit 1' nginx
```

## Default Value

By default, health checks are not carried out at container runtime.

## References

1. https://docs.docker.com/engine/reference/run/#healthcheck

## CIS Controls

**v8:**
- **10.5 Enable Anti-Exploitation Features**
  - Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft® Data Execution Prevention (DEP), Windows® Defender Exploit Guard (WDEG), or Apple® System Integrity Protection (SIP) and Gatekeeper™.

**v7:**
- **3.1 Run Automated Vulnerability Scanning Tools**
  - Utilize an up-to-date SCAP-compliant vulnerability scanning tool to automatically scan all systems on the network on a weekly or more frequent basis to identify all potential vulnerabilities on the organization's systems.
