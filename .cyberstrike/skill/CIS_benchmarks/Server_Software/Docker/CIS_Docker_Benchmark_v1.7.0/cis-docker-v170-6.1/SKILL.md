---
name: cis-docker-v170-6.1
description: "Ensure that image sprawl is avoided"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, security-operations, images, sprawl]
cis_id: "6.1"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 6.1

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

You should not keep a large number of container images on the same host. Use only tagged images as appropriate.

## Rationale

Tagged images are useful if you need to fall back from the "latest" version to a specific version of an image in production. Images with unused or old tags may contain vulnerabilities that might be exploited if instantiated.

## Impact

`docker system prune -a` removes all exited containers as well as all images and volumes that are not referenced by running containers. If any images are removed, this would result in needing to reload the images to the host.

## Audit Procedure

**Step 1:** Make a list of all image IDs that are currently instantiated by executing the command below:

```bash
docker images --quiet | xargs docker inspect --format '{{ .Id }}: Image={{ .Config.Image }}'
```

**Step 2:** List all the images present on the system by executing the command below:

```bash
docker images
```

**Step 3:** Compare the list of image IDs from Step 1 and Step 2 and look for images that are currently not in use. If any unused or old images are found, discuss with the system administrator the need to keep such images on the system. If images are no longer needed they should be deleted.

## Remediation

You should keep only the images that you actually need and establish a workflow to remove old or stale images from the host. Additionally, you should use features such as pull-by-digest to get specific images from the registry.

You can follow the steps below to find unused images on the system so they can be deleted.

**Step 1:** Make a list of all image IDs that are currently instantiated by executing the command below:

```bash
docker images --quiet | xargs docker inspect --format '{{ .Id }}: Image={{ .Config.Image }}'
```

**Step 2:** List all the images present on the system by executing the command below:

```bash
docker images
```

**Step 3:** Compare the list of image IDs created from Step 1 and Step 2 to find out images which are currently not being instantiated.

**Step 4:** Decide if you want to keep the images that are not currently in use. If they are not needed, delete them by executing the following command:

```bash
docker rmi <IMAGE ID>
```

Alternatively, the `docker system prune` command can be used to remove dangling images which are not tagged or, if necessary, all images that are not currently used by a running container when used with the `-a` option.

## Default Value

Images and layered filesystems remain accessible on the host until the administrator removes all tags that refer to those images or layers.

## References

1. https://docs.docker.com/config/pruning/
2. https://docs.docker.com/engine/reference/commandline/rmi/
3. https://docs.docker.com/engine/reference/commandline/pull/

## CIS Controls

**v8:**
- **16.10 Apply Secure Design Principles in Application Architectures**
  - Apply secure design principles in application architectures. Secure design principles include the concept of least privilege and enforcing mediation to validate every operation that the user makes, promoting the concept of "never trust user input." Examples include ensuring that explicit trust zones are documented for all application interactions, such as data encoding/escaping expected outputs, and surface, such as turning off unprotected ports and services; removing unnecessary programs and files; and renaming default accounts.

**v7:**
- **5.3 Securely Store Master Images**
  - Store the master images and templates on securely configured servers, validated with integrity monitoring tools, to ensure that only authorized changes to the images are possible.
