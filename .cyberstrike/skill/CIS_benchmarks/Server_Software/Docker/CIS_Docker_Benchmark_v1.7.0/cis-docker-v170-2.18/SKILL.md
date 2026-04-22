---
name: cis-docker-v170-2.18
description: "Ensure that experimental features are not implemented in production"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, experimental, production]
cis_id: "2.18"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.18

## Profile Applicability

- **Level:** 1 - Docker - Linux

## Description

Experimental features should not be enabled in production.

## Rationale

"Experimental" is currently a runtime Docker daemon flag rather than being a feature of a separate build. Passing `--experimental` as a runtime flag to the docker daemon activates experimental features. Whilst "Experimental" is considered a stable release, it has a number of features which may not have been fully tested and do not guarantee API stability.

## Impact

None

## Audit Procedure

You should run the command below and ensure that the `Experimental` property is set to `false` in the Server section.

```bash
docker version --format '{{ .Server.Experimental }}'
```

## Remediation

You should not pass `--experimental` as a runtime parameter to the Docker daemon on production systems.

## Default Value

By default, experimental features are not activated in the Docker daemon.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br/>Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. |      | ●    | ●    |
| v7               | 18 Application Software Security<br/>Application Software Security                                                                                                                                                                                    |      |      |      |

## Profile

**Level 1 - Docker - Linux** (Manual)
