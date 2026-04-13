---
name: cis-docker-2.7
description: "Ensure devicemapper storage driver is not used"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, storage-driver, devicemapper]
cis_id: "2.7"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure devicemapper storage driver is not used (Manual)

## Profile Applicability

• Level 1 - Docker - Linux

## Description

Do not use `devicemapper` as the storage driver for your Docker instance.

## Rationale

The `devicemapper` storage driver is deprecated in favor of overlay2, and has been removed in Docker Engine v25.0.

## Impact

If you are using Device Mapper, you must migrate to a supported storage driver before upgrading to Docker Engine v25.0.

## Audit Procedure

Execute the below command and verify that `devicemapper` is not used as storage driver:

```bash
docker info --format 'Storage Driver: {{ .Driver }}'
```

The above command should not return `devicemapper`.

## Remediation

Do not explicitly use `devicemapper` as storage driver.

For example, do not start Docker daemon as below:

```bash
dockerd --storage-driver devicemapper
```

## Default Value

By default, Docker uses `overlay2` as the storage driver on most of the platforms. The default storage driver can vary based on your OS vendor. You should use the storage driver that is recommended by your preferred vendor and which is in line with policy around the applications which are being deployed.

## References

1. https://docs.docker.com/storage/storagedriver/select-storage-driver/

## CIS Controls

**Controls Version:** v8

**Control:** 16 Application Software Security

Manage the security life cycle of in-house developed, hosted, or acquired software to prevent, detect, and remediate security weaknesses before they can impact the enterprise.

**IG 1:**
**IG 2:**
**IG 3:**

---

**Controls Version:** v7

**Control:** 18 Application Software Security

Application Software Security
