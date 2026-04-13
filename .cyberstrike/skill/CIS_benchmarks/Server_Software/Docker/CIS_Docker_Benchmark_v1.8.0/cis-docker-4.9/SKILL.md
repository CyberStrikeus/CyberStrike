---
name: cis-docker-4.9
description: "Ensure that COPY is used instead of ADD in Dockerfiles"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, images, dockerfile, build]
cis_id: "4.9"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.9 Ensure that COPY is used instead of ADD in Dockerfiles (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should use the `COPY` instruction instead of the `ADD` instruction in the Dockerfile.

## Rationale

The `COPY` instruction simply copies files from the local host machine to the container file system. The `ADD` instruction could potentially retrieve files from remote URLs and perform operations such as unpacking them. The `ADD` instruction therefore introduces security risks. For example, malicious files may be directly accessed from URLs without scanning, or there may be vulnerabilities associated with decompressing them.

## Impact

Care needs to be taken in implementing this control if the application requires functionality that is part of the `ADD` instruction, for example, if you need to retrieve files from remote URLs.

## Audit Procedure

Run the command below to get the list of images:

```bash
docker images
```

Run the command below against each image in the list above and look for any `ADD` instructions:

```bash
docker history <IMAGE_ID>
```

Alternatively, if you have access to the Dockerfile for the image, you should verify that there are no `ADD` instructions.

## Remediation

You should use `COPY` rather than `ADD` instructions in Dockerfiles.

## Default Value

Not Applicable

## References

1. https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#add-or-copy

## CIS Controls

### v8

**16.7 Use Standard Hardening Configuration Templates for Application Infrastructure**

Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

### v7

**5.2 Maintain Secure Images**

Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.
