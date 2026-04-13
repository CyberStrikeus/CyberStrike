---
name: cis-docker-v170-2.1
description: "Run the Docker daemon as a non-root user, if possible"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, rootless, privilege]
cis_id: "2.1"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.1

## Profile Applicability
- **Level:** 1 - Docker - Linux

## Description
Rootless mode executes the Docker daemon and containers inside a user namespace, with both the daemon and the container are running without root privileges.

## Rationale
Rootless mode allows running the Docker daemon and containers as a non-root user to mitigate potential vulnerabilities in the daemon and the container runtime.

## Impact
There are multiple prerequisites depending on which distribution that is in use, and also known limitations regarding networking and resource limitation.

Running in rootless mode also changes the location of any configuration files in use, including all containers using the daemon.

## Audit Procedure

Running the following command will show any running `dockerd` processes and which user that is managing the daemon.

```bash
ps -fe | grep 'dockerd'
```

## Remediation

Follow the current Docker documentation on how to install the Docker daemon as a non-root user.

## Default Value
The Docker daemon is running as the `root` user by default.

## References
1. https://docs.docker.com/engine/security/rootless/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process<br/>Establish and maintain a secure configuration process for enterprise assets (end-user devices, including portable and mobile, non-computing/IoT devices, and servers) and software (operating systems and applications). Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br/>Controlled Use of Administrative Privileges | | | |

## Profile
**Level 1 - Docker - Linux** (Manual)
