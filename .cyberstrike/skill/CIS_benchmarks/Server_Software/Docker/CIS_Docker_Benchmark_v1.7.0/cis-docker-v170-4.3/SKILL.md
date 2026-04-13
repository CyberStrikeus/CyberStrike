---
name: cis-docker-v170-4.3
description: "Ensure that unnecessary packages are not installed in the container"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, attack-surface]
cis_id: "4.3"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-1395]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.3

## Profile Applicability
- Level 1 - Docker - Linux

## Description
Containers should have as small a footprint as possible, and should not contain unnecessary software packages which could increase their attack surface.

## Rationale
Unnecessary software should not be installed into containers, as doing so increases their attack surface. Only packages strictly necessary for the correct operation of the application being deployed should be installed.

## Impact
None.

## Audit Procedure

List all the running instances of containers by executing the command below:

```bash
docker ps --quiet
```

For each container instance, execute the relevant command for listing all installed packages, e.g.:

```bash
docker exec $INSTANCE_ID rpm -qa
```

The command above lists the packages installed. You should review the list and ensure that everything installed is actually required.

## Remediation

You should not install anything within the container that is not required.

You should consider using a minimal base image rather than the standard Centos, Debian, or Red Hat images if you can. Some of the options available include BusyBox and Alpine.

Not only can this trim your image size considerably, but there would also be fewer pieces of software which could contain vectors for attack.

## Default Value
Not Applicable.

## References
1. https://docs.docker.com/develop/develop-images/baseimages/
2. https://jpetazzo.github.io/2020/02/01/quest-minimal-docker-images-part-1/

## CIS Controls

**v8:**
- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**
- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status
Manual
