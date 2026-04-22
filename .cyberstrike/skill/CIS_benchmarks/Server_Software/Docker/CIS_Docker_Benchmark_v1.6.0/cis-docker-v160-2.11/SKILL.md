---
name: cis-docker-v160-2.11
description: "Ensure base device size is not changed until needed"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, daemon, storage, base-device-size]
cis_id: "2.11"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure base device size is not changed until needed

**Profile Applicability:** Level 2 - Docker - Linux

**Assessment Status:** Manual

## Description

Under certain circumstances, you might need containers larger than 10G. Where this applies you should carefully choose the base device size.

## Rationale

The base device size can be increased on daemon restart. Increasing the base device size allows all future images and containers to be of the new base device size. A user can use this option to expand the base device size however shrinking is not permitted. This value affects the system wide "base" empty filesystem that may already be initialized and therefore inherited by pulled images.

Although the file system does not allocate the increased size as long as it is empty, more space will be allocated for extra images. This may cause a denial of service condition if the allocated partition becomes full.

## Impact

None.

## Audit Procedure

To confirm this setting the dockerd start-up options and any settings in `/etc/docker/daemon.json` should be reviewed.
To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

Execute the above command and it should not show any `--storage-opt dm.basesize` parameters.
The contents of `/etc/docker/daemon.json` should also be reviewed

## Remediation

Do not set `--storage-opt dm.basesize` until needed.

## Default Value

The default base device size is 10G.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#storage-driver-options

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening. | | ● | ● |
| v7 | 18 Application Software Security<br>Application Software Security | | | |

## Profile/Assessment Status

**Profile:** Level 2 - Docker - Linux
**Assessment Status:** Manual
