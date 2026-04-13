---
name: cis-docker-v170-5.28
description: "Ensure that Docker commands always make use of the latest version of their image"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, images, versioning]
cis_id: "5.28"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.28

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

You should always ensure that you are using the latest version of the images within your repository and not cached older versions.

## Rationale

Multiple Docker commands such as `docker pull`, `docker run` etc. are known to have an issue where by default, they extract the local copy of the image, if present, even though there is an updated version of the image with the same tag in the upstream repository. This could lead to using older images containing known vulnerabilites.

## Impact

None

## Audit Procedure

You should carry out the following steps:

**Step 1:** Open your image repository and list the image version history for the image you are inspecting.

**Step 2:** Observe the status when the `docker pull` command is triggered.

If the status is shown as `Image is up to date`, it means that you are getting the cached version of the image.

**Step 3:** Match the version of the image you are running to the latest version reported in your repository and this will tell you whether you are running the cached version or the latest copy.

## Remediation

You should use proper version pinning mechanisms (the "latest" tag which is assigned by default is still vulnerable to caching attacks) to avoid extracting cached older versions. Version pinning mechanisms should be used for base images, packages, and entire images. You can customize version pinning rules according to your requirements.

## Default Value

By default, Docker commands extract the local copy unless version pinning mechanisms are used or the local cache is cleared.

## References

1. https://docs.docker.com/engine/reference/commandline/pull/

## CIS Controls

**v8:**
- **16 Application Software Security**
  - Manage the security life cycle of in-house developed, hosted, or acquired software to prevent, detect, and remediate security weaknesses before they can impact the enterprise.

**v7:**
- **5.2 Maintain Secure Images**
  - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.
