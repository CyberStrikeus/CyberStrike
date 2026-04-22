---
name: cis-docker-v170-4.7
description: "Ensure update instructions are not used alone in Dockerfiles"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, caching]
cis_id: "4.7"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.7

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should not use OS package manager update instructions such as `apt-get update` or `yum update` either alone or in a single line in any Dockerfiles used to generate images under review.

## Rationale

Adding update instructions in a single line on the Dockerfile will cause the update layer to be cached. When you then build any image later using the same instruction, this will cause the previously cached update layer to be used, potentially preventing any fresh updates from being applied to later builds.

## Impact

None

## Audit Procedure

Step 1: Run the command below to get the list of images:

```bash
docker images
```

Step 2: Run the command below against each image in the list above, looking for any update instructions which are incorporated in a single line:

```bash
docker history <Image_ID>
```

Alternatively, if you have access to the Dockerfile for the image, you should verify that there are no update instructions configured as described above.

## Remediation

You should use update instructions together with install instructions and version pinning for packages while installing them. This will prevent caching and force the extraction of the required versions.

Alternatively, you could use the `--no-cache` flag during the `docker build` process to avoid using cached layers.

## Default Value

By default, Docker does not enforce any restrictions on using update instructions.

## References

1. https://docs.docker.com/develop/develop-images/dockerfile_best-practices/

## CIS Controls

**v8:**

- 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure - Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**v7:**

- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status

Manual
