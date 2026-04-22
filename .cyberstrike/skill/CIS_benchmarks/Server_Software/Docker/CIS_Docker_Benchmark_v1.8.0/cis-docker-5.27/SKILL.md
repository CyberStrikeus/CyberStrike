---
name: cis-docker-5.27
description: "Ensure that container health is checked at runtime"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime]
cis_id: "5.27"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.27 Ensure that container health is checked at runtime (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

If the container image does not have an `HEALTHCHECK` instruction defined, you should use the `--health-cmd` parameter at container runtime to check container health.

## Rationale

If the container image you are using does not have a pre-defined `HEALTHCHECK` instruction, use the `--health-cmd` parameter to check container health at runtime.

Based on the reported health status, remedial actions can be taken if necessary.

## Impact

None.

## Audit Procedure

You should run the command below and ensure that all containers are reporting their health status:

```
docker ps --quiet | xargs docker inspect --format '{{ .Id }}: Health={{ .State.Health.Status }}'
```

## Remediation

You should run the container using the `--health-cmd` parameter.
For example:

```
docker run -d --health-cmd='stat /etc/passwd || exit 1' nginx
```

## Default Value

By default, health checks are not carried out at container runtime.

## References

1. https://docs.docker.com/engine/reference/run/#healthcheck

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.5 Enable Anti-Exploitation Features<br>Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft® Data Execution Prevention (DEP), Windows® Defender Exploit Guard (WDEG), or Apple® System Integrity Protection (SIP) and Gatekeeper™. |      | ●    | ●    |
| v7               | 3.1 Run Automated Vulnerability Scanning Tools<br>Utilize an up-to-date SCAP-compliant vulnerability scanning tool to automatically scan all systems on the network on a weekly or more frequent basis to identify all potential vulnerabilities on the organization's systems.             |      | ●    | ●    |
