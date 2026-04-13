---
name: cis-docker-v170-2.9
description: "Enable user namespace support"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, userns, namespace, privilege]
cis_id: "2.9"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.9

## Profile Applicability
- **Level:** 2 - Docker - Linux

## Description
You should enable user namespace support in Docker daemon to utilize container user to host user re-mapping. This recommendation is beneficial where the containers you are using do not have an explicit container user defined in the container image. If the container images that you are using have a pre-defined non-root user, this recommendation may be skipped as this feature is still in its infancy, and might result in unpredictable issues or difficulty in configuration.

## Rationale
The Linux kernel "user namespace" support within the Docker daemon provides additional security for the Docker host system. It allows a container to have a unique range of user and group IDs which are outside the traditional user and group range utilized by the host system.

For example, the root user can have the expected administrative privileges inside the container but can effectively be mapped to an unprivileged UID on the host system.

## Impact
User namespace remapping is incompatible with a number of Docker features and also currently breaks some of its functionalities. Reference the Docker documentation and included links for details.

## Audit Procedure

```bash
docker inspect --format='{{ .State.Pid }}' $(docker ps -q) | while read -r line; do ps -h -p "$line" -o pid,user; done
```

The above command will find the PID of the container and then list the host user associated with the container process. If the container process is running as `root`, then this configuration may be non-compliant with your organization's security policy.

Alternatively, you can run `docker info` to ensure that the `userns` is listed under `Security Options:`.

```bash
docker info --format '{{ .SecurityOptions }}'
```

## Remediation

Please consult the Docker documentation for various ways in which this can be configured depending upon your requirements. Your steps might also vary based on platform - For example, on Red Hat, sub-UIDs and sub-GIDs mapping creation do not work automatically. You might have to create your own mapping.

The high-level steps are as below:

Step 1: Ensure that the files `/etc/subuid` and `/etc/subgid` exist.

```bash
touch /etc/subuid /etc/subgid
```

Step 2: Start the docker daemon with `--userns-remap` flag

```bash
dockerd --userns-remap=default
```

## Default Value
By default, user namespace is not remapped. Consideration should be given to implementing this in line with the requirements of the applications being used and the organization's security policy.

## References
1. https://man7.org/linux/man-pages/man7/user_namespaces.7.html
2. https://docs.docker.com/engine/reference/commandline/dockerd/#daemon-user-namespace-options

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6 Access Control Management<br/>Use processes and tools to create, assign, manage, and revoke access credentials and privileges for user, administrator, and service accounts for enterprise assets and software. | | | |
| v7 | 18 Application Software Security<br/>Application Software Security | | | |

## Profile
**Level 2 - Docker - Linux** (Manual)
