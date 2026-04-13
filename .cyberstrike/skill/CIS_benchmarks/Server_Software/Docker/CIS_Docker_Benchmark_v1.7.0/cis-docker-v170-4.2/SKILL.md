---
name: cis-docker-v170-4.2
description: "Ensure that containers use only trusted base images"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, supply-chain]
cis_id: "4.2"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-494]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.2

## Profile Applicability
- Level 1 - Docker - Linux

## Description
You should ensure that container images you use are either written from scratch or are based on another established and trusted base image downloaded over a secure channel.

## Rationale
Official repositories contain Docker images curated and optimized by the Docker community or by their vendor. There is no guarantee that these images are safe and do not contain security vulnerabilities or malicious code. Caution should therefore be exercised when obtaining container images from Docker and third parties and running these images should be reviewed in line with organizational security policy.

## Impact
None.

## Audit Procedure

You should review what Docker images are present on the host by executing the command below:

```bash
docker images
```

This command lists all the container images that are currently available for use on the Docker host. You should then review the origin of each image and review its contents in line with your organization's security policy.

You can use the command below to review the history of commits to the image.

```bash
docker history <imageName>
```

## Remediation

The following procedures are useful for establishing trust for a specific image.

- Configure and use Docker Content trust.
- View the history of each Docker image to evaluate its risk, dependent on the sensitivity of the application you wish to deploy using it.
- Scan Docker images for vulnerabilities at regular intervals.

## Default Value
Not Applicable.

## References
1. https://docs.docker.com/engine/reference/commandline/pull/
2. https://registry.hub.docker.com/
3. https://access.redhat.com/blogs/766093/posts/1976473

## CIS Controls

**v8:**
- 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure - Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**v7:**
- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status
Manual
