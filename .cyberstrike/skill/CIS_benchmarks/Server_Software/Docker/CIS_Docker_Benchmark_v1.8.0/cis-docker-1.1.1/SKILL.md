---
name: cis-docker-1.1.1
description: "Ensure a separate partition for containers has been created"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, host-configuration, auditing]
cis_id: "1.1.1"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a separate partition for containers has been created (Manual)

## Description

All Docker containers and their data and metadata is stored under `/var/lib/docker` directory. By default, `/var/lib/docker` should be mounted under either the `/` or `/var` partitions dependent on how the Linux operating system in use is configured.

## Rationale

Docker depends on `/var/lib/docker` as the default directory where all Docker related files, including the images, are stored. This directory could fill up quickly causing both Docker and the host to become unusable. For this reason, you should create a separate partition (logical volume) for storing Docker files.

## Impact

None.

## Audit

At the Docker host execute one of the below commands:

```bash
grep '/var/lib/docker\s' /proc/mounts
```

This should return the partition details for the `/var/lib/docker` mountpoint.

```bash
mountpoint -- "$(docker info -f '{{ .DockerRootDir }}')"
```

This should return whether the configured root directory is a mount point.

## Remediation

For new installations, you should create a separate partition for the `/var/lib/docker` mount point. For systems which have already been installed, you should use the Logical Volume Manager (LVM) within Linux to create a new partition.

## Default Value

By default, `/var/lib/docker` is mounted under the `/` or `/var` partitions dependent on how the OS is configured.

## References

1. https://www.projectatomic.io/docs/docker-storage-recommendation/
2. https://docs.docker.com/storage/

## CIS Controls

**Controls Version | Control | IG 1 | IG 2 | IG 3**

v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity
Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data. | | ● | ●

v7 | 14 Controlled Access Based on the Need to Know
Controlled Access Based on the Need to Know | | |

## Profile

• Level 1 - Docker - Linux
