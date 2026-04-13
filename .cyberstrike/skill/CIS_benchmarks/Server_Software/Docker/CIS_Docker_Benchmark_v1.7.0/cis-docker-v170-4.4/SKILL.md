---
name: cis-docker-v170-4.4
description: "Ensure images are scanned and rebuilt to include security patches"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, vulnerability-management]
cis_id: "4.4"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-1357]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.4

## Profile Applicability
- Level 1 - Docker - Linux

## Description
Images should be scanned frequently for any vulnerabilities. You should rebuild all images to include these patches and then instantiate new containers from them.

## Rationale
Vulnerabilities are loopholes or bugs that can be exploited by hackers or malicious users, and security patches are updates to resolve these vulnerabilities. Image vulnerability scanning tools can be use to find vulnerabilities in images and then check for available patches to mitigate these. Patches update the system to a more recent code base which does not contain these problems, and being on a supported version of the code base is very important, as vendors will not be able to supply patches for older versions which have gone out of support. Security patches should be evaluated before applying and patching should be implemented in line with the organization's IT Security Policy.

Care should be taken with the results returned by vulnerability assessment tools, as some will simply return results based on software banners, and these may not be entirely accurate.

## Impact
None

## Audit Procedure

List all the running instances of containers by executing the command below:

```bash
docker ps --quiet
```

For each container instance, use the package manager within the container (assuming there is one available) to check for the availability of security patches.

Alternatively, run image vulnerability assessment tools to scan all the images in your environment.

## Remediation

Images should be re-built ensuring that the latest version of the base images are used, to keep the operating system patch level at an appropriate level. Once the images have been re-built, containers should be re-started making use of the updated images.

## Default Value
By default, containers and images are not updated automatically to address missing operating system security patches.

## References
1. https://docs.docker.com/engine/reference/builder/#onbuild

## CIS Controls

**v8:**
- 7.5 Perform Automated Vulnerability Scans of Internal Enterprise Assets - Perform automated vulnerability scans of internal enterprise assets on a quarterly, or more frequent, basis. Conduct both authenticated and unauthenticated scans, using a SCAP-compliant vulnerability scanning tool.

**v7:**
- 18.3 Verify That Acquired Software is Still Supported - Verify that the version of all software acquired from outside your organization is still supported by the developer or appropriately hardened based on developer security recommendations.

## Assessment Status
Manual
