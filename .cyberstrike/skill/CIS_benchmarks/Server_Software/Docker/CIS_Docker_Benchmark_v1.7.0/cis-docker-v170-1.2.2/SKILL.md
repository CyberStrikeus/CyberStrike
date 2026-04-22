---
name: cis-docker-v170-1.2.2
description: "Ensure that the version of Docker is up to date"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, patching, version-management]
cis_id: "1.2.2"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 1.2.2

## Profile

- **Level:** 1 - Docker - Linux
- **Assessment Status:** Manual

## Description

Frequent releases for Docker are issued which address security vulnerabilities, resolve product bugs and bring in new functionality. You should keep a tab on these product updates and upgrade as frequently as possible in line with the general IT security policy of your organization.

## Rationale

By staying up to date on Docker updates, vulnerabilities in the software can be mitigated. An experienced attacker may be able to exploit known vulnerabilities resulting in them being able to attain inappropriate access or to elevate their privileges. If you do not ensure that Docker is running the most current release consistent with the requirements of of your application, you may introduce unwanted behaviour and it is therefore important to ensure that you monitor software versions and upgrade in a timely fashion.

## Impact

You should perform a risk assessment regarding Docker version updates and review how they may impact your operations. You should be aware that third-party products that use Docker may require older major versions of Docker to be supported, and this should be reviewed in line with the general IT security policy of your organization, particularly where security vulnerabilities in older versions have been publicly disclosed.

## Audit Procedure

You should execute the command below in order to verify that the Docker version is up to date in line with the requirements of the application you are running. It should be noted that it is not a security requirement to be at the most up to date version, provided the version you are using does not contain any critical or high security vulnerabilities.

```bash
docker version
```

## Remediation

You should monitor versions of Docker releases and make sure your software is updated as required.

## Default Value

Not Applicable

## References

1. https://docs.docker.com/engine/install/
2. https://docs.docker.com/engine/release-notes/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.5 Use Up-to-Date and Trusted Third-Party Software Components<br/>Use up-to-date and trusted third-party software components. When possible, choose established and proven frameworks and libraries that provide adequate security. Acquire these components from trusted sources or evaluate the software for vulnerabilities before use. |      | ●    | ●    |
| v7               | 3 Continuous Vulnerability Management<br/>Continuous Vulnerability Management                                                                                                                                                                                                                                                                |      |      |      |
