---
name: cis-docker-4.5
description: "Ensure Content trust for Docker is Enabled"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, images, content-trust, security]
cis_id: "4.5"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5 Ensure Content trust for Docker is Enabled (Manual)

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Content trust is disabled by default and should be enabled in line with organizational security policy.

## Rationale

Content trust provides the ability to use digital signatures for data sent to and received from remote Docker registries. These signatures allow client-side verification of the identity and the publisher of specific image tags and ensures the provenance of container images.

## Impact

In an environment where `DOCKER_CONTENT_TRUST` is set, you are required to follow trust procedures whilst working with the image related commands - `build`, `create`, `pull`, `push` and `run`. You can use the `--disable-content-trust` flag to run individual operations on tagged images without content trust on an as needed basis, but this defeats the purpose of enabling content trust and therefore should be avoided wherever possible.

Note: Content trust is currently only available for users of the public Docker Hub. It is currently not available for the Docker Trusted Registry or for private registries.

## Audit Procedure

You should execute the following command:

```bash
echo $DOCKER_CONTENT_TRUST
```

This should return a value of 1.

## Remediation

To enable content trust in a bash shell, you should enter the following command:

```bash
export DOCKER_CONTENT_TRUST=1
```

Alternatively, you could set this environment variable in your profile file so that content trust in enabled on every login.

## Default Value

By default, content trust is disabled.

## References

1. https://docs.docker.com/engine/security/trust/
2. https://docs.docker.com/notary/service_architecture/
3. https://docs.docker.com/engine/reference/commandline/cli/#environment-variables

## CIS Controls

### v8

**3 Data Protection**

Develop processes and technical controls to identify, classify, securely handle, retain, and dispose of data.

### v7

**13 Data Protection**

Data Protection
