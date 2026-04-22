---
name: cis-docker-v160-2.6
description: "Ensure aufs storage driver is not used"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, daemon, storage-driver, aufs, deprecated]
cis_id: "2.6"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure aufs storage driver is not used

**Profile Applicability:** Level 1 - Docker - Linux

**Assessment Status:** Manual

## Description

Do not use `aufs` as the storage driver for your Docker instance.

## Rationale

The `aufs` storage driver is the oldest storage driver used on Linux systems. It is based on a Linux kernel patch-set that is unlikely in future to be merged into the main OS kernel. The `aufs` driver is also known to cause some serious kernel crashes. `aufs` only has legacy support within systems using Docker.

Most importantly, `aufs` is not a supported driver in many Linux distributions using latest Linux kernels and has also been deprecated with Docker Engine release 20.10.

## Impact

`aufs` is the only storage driver that allows containers to share executable and shared library memory. It might be useful if you are running thousands of containers with the same program or libraries, however its use should be reviewed in line with your organization's security policy.

## Audit Procedure

Execute the below command and verify that `aufs` is not used as storage driver:

```bash
docker info --format 'Storage Driver: {{ .Driver }}'
```

The above command should not return `aufs`.

## Remediation

Do not explicitly use `aufs` as storage driver.
For example, do not start Docker daemon as below:

```bash
dockerd --storage-driver aufs
```

## Default Value

By default, Docker uses `overlay2` as the storage driver on most of the platforms. The default storage driver can vary based on your OS vendor. You should use the storage driver that is recommended by your preferred vendor and which is in line with policy around the applications which are being deployed.

## References

1. https://docs.docker.com/storage/storagedriver/select-storage-driver/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16 Application Software Security<br>Manage the security life cycle of in-house developed, hosted, or acquired software to prevent, detect, and remediate security weaknesses before they can impact the enterprise. |      |      |      |
| v7               | 18 Application Software Security<br>Application Software Security                                                                                                                                                   |      |      |      |

## Profile/Assessment Status

**Profile:** Level 1 - Docker - Linux
**Assessment Status:** Manual
