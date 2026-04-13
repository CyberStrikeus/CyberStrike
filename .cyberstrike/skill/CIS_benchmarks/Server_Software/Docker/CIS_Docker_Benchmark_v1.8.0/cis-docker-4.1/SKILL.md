---
name: cis-docker-4.1
description: "Ensure that a user for the container has been created"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, images, dockerfile, build, user, non-root]
cis_id: "4.1"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure that a user for the container has been created (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

Containers should run as a non-root user.

## Rationale

It is good practice to run the container as a non-root user, where possible. This can be done either via the `USER` directive in the `Dockerfile` or through `gosu` or similar where used as part of the `CMD` or `ENTRYPOINT` directives.

## Impact

Running as a non-root user can present challenges where you wish to bind mount volumes from the underlying host. In this case, care should be taken to ensure that the user running the contained process can read and write to the bound directory, according to their requirements.

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet | xargs --max-args=1 -I[] docker exec [] cat /proc/1/status | grep '^Uid:' | awk '{print $3}'
```

This should return the effective UID for each container and where it returns 0, it indicates that the container process is running as root.

Note that some services may start as the root user and then starts all other related processes as an unprivileged user.

## Remediation

You should ensure that the Dockerfile for each container image contains the information below:

```dockerfile
USER <username or ID>
```

In this case, the user name or ID refers to the user that was found in the container base image. If there is no specific user created in the container base image, then make use of the `useradd` command to add a specific user before the `USER` instruction in the Dockerfile.

For example, add the below lines in the Dockerfile to create a user in the container:

```dockerfile
RUN useradd -d /home/username -m -s /bin/bash username
USER username
```

Note: If there are users in the image that are not needed, you should consider deleting them. After deleting those users, commit the image and then generate new instances of the containers.

Alternatively, if it is not possible to set the `USER` directive in the Dockerfile, a script running as part of the `CMD` or `ENTRYPOINT` sections of the Dockerfile should be used to ensure that the container process switches to a non-root user.

## Default Value

By default, containers are run with `root` privileges and also run as the `root` user inside the container.

## References

1. https://docs.docker.com/engine/reference/builder/#user
2. https://docs.docker.com/engine/reference/run/#user

## CIS Controls

### v8

**5 Account Management**

Use processes and tools to assign and manage authorization to credentials for user accounts, including administrator accounts, as well as service accounts, to enterprise assets and software.

### v7

**4 Controlled Use of Administrative Privileges**

Controlled Use of Administrative Privileges
