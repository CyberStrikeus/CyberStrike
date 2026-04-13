---
name: cis-docker-v170-5.18
description: "Ensure that host devices are not directly exposed to containers"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, devices, privileges]
cis_id: "5.18"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.18

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

Host devices can be directly exposed to containers at runtime. Do not directly expose host devices to containers, especially to containers that are not trusted.

## Rationale

The `--device` option exposes host devices to containers and as a result of this, containers can directly access these devices. The the container would not need to run in privileged mode to access and manipulate them, as by default, the container is granted this type of access. Additionally, it would possible for containers to remove block devices from the host. You therefore should not expose host devices to containers directly.

If for some reason you wish to expose the host device to a container you should consider which sharing permissions you wish to use on a case by case base as appropriate to your organization:

- `r` - read only
- `w` - writable
- `m` - mknod allowed

## Impact

You would not be able to use host devices directly within containers.

## Audit Procedure

You should use the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: Devices={{ .HostConfig.Devices }}'
```

The above command would list out each device with below information:

- `CgroupPermissions` - For example, `rwm`
- `PathInContainer` - Device path within the container
- `PathOnHost` - Device path on the host

You should verify that the host device is needed to be accessed from within the container and that the permissions required are correctly set. If the above command returns [], then the container does not have access to host devices and is configured in line with good security practice.

## Remediation

You should not directly expose host devices to containers. If you do need to expose host devices to containers, you should use granular permissions as appropriate to your organization.

For example, do not start a container using the command below:

```bash
docker run --interactive --tty --device=/dev/tty0:/dev/tty0:rwm --device=/dev/temp_sda:/dev/temp_sda:rwm centos bash
```

You should only share the host device using appropriate permissions:

```bash
docker run --interactive --tty --device=/dev/tty0:/dev/tty0:rw --device=/dev/temp_sda:/dev/temp_sda:r centos bash
```

## Default Value

By default, host devices are not exposed to containers. If you do not provide sharing permissions and choose to expose a host device to a container, the host device is be exposed with `read`, `write` and `mknod` permissions.

## References

1. https://docs.docker.com/engine/reference/commandline/run/#add-host-device-to-container---device

## CIS Controls

**v8:**
- **5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts**
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**v7:**
- **14 Controlled Access Based on the Need to Know**
  - Controlled Access Based on the Need to Know
