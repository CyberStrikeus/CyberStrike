---
name: cis-docker-v170-4.1
description: "Ensure that a user for the container has been created"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, user]
cis_id: "4.1"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-250]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.1

## Profile Applicability
- Level 1 - Docker - Linux

## Description
You should ensure that a specific user is created for running the container process. Containers should not be running as the root user.

## Rationale
Creating a user inside the container and running the container process with that non-root user is a well-established practice. This is valuable because it is easier to initiate a root process inside a container rather than from outside the container. Running as a non-root user inside the container makes it harder for an attacker to escalate privileges on the compromised host since most processes inside containers do not need root privilege.

## Impact
None

## Audit Procedure

Step 1: Run the command below to list all running container instances:

```bash
docker ps --quiet
```

Step 2: For each container instance, execute the command below:

```bash
docker exec $INSTANCE_ID cat /etc/passwd
```

Ensure that there is a user entry in the output other than root.

Alternatively, you can run `docker exec $INSTANCE_ID ps -u` to list the current user for the processes running inside the container. The container should not be running as a root user.

## Remediation

You should ensure that the Dockerfile for each container image contains the information below:

```dockerfile
RUN useradd -d /home/username -m -s /bin/bash username
USER username
```

Note: If there are users in the image that are not needed, you should consider deleting them. After deleting those users, commit the image and then generate new instances of the containers.

Alternatively, if it is not possible to set the `USER` directive in the Dockerfile, a script running as part of the `CMD` or `ENTRYPOINT` sections of the Dockerfile should be used to ensure that the container process switches to a non-root user.

## Default Value
By default, containers are run with root privileges and also run as the `root` user inside the container.

## References
1. https://docs.docker.com/engine/reference/builder/#user
2. https://docs.docker.com/engine/reference/run/#user

## CIS Controls

**v8:**
- 5 Account Management - Use processes and tools to assign and manage authorization to credentials for user accounts, including administrator accounts, as well as service accounts, to enterprise assets and software.

**v7:**
- 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges

## Assessment Status
Manual
