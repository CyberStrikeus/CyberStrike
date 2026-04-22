---
name: cis-docker-v170-2.17
description: "Ensure that a daemon-wide custom seccomp profile is applied if appropriate"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, seccomp, syscall, hardening]
cis_id: "2.17"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.17

## Profile Applicability

- **Level:** 2 - Docker - Linux

## Description

You can choose to apply a custom seccomp profile at a daemon-wide level if needed with this overriding Docker's default seccomp profile.

## Rationale

A large number of system calls are exposed to every userland process with many of them not utilized during the entire lifetime of the process. Many applications do not need all the system calls and therefore having the ability to filter the system calls currently in use reviewed in line with organizational security policy. A reduced set of system calls reduces the total kernel surface exposed to the application and therefore improves application security.

A custom seccomp profile can be applied instead of Docker's default seccomp profile. Alternatively, if Docker's default profile is adequate for your environment, you can choose to ignore this recommendation.

## Impact

A misconfigured seccomp profile could possibly interrupt your container environment. Docker-default blocked calls have been carefully scrutinized and address some critical vulnerabilities/issues within container environments (for example, kernel key ring calls). You should therefore exercise extreme care if you choose to override the default settings.

## Audit Procedure

You should run the command below and review the seccomp profile listed in the `Security Options` section. If it is `default` this indicates that Docker's default seccomp profile is applied.

```bash
docker info --format '{{ .SecurityOptions }}'
```

## Remediation

By default, Docker's default seccomp profile is applied. If this is adequate for your environment, no action is necessary. Alternatively, if you choose to apply your own seccomp profile, use the `--seccomp-profile` flag at daemon start or put it in the daemon runtime parameters file.

For example,

```bash
dockerd --seccomp-profile </path/to/seccomp/profile>
```

## Default Value

By default, Docker applies a default seccomp profile.

## References

1. https://docs.docker.com/engine/security/seccomp/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16 Application Software Security<br/>Manage the security life cycle of in-house developed, hosted, or acquired software to prevent, detect, and remediate security weaknesses before they can impact the enterprise. |      |      |      |
| v7               | 18 Application Software Security<br/>Application Software Security                                                                                                                                                   |      |      |      |

## Profile

**Level 2 - Docker - Linux** (Manual)
