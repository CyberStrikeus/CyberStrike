---
name: cis-docker-v170-2.5
description: "Ensure insecure registries are not used"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, configuration, registry, tls, encryption]
cis_id: "2.5"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 2.5

## Profile Applicability
- **Level:** 1 - Docker - Linux

## Description
Docker considers a private registry either secure or insecure. By default, registries are considered secure.

## Rationale
A secure registry uses TLS. A copy of registry's CA certificate is placed on the Docker host at `/etc/docker/certs.d/<registry-name>/` directory. An insecure registry is one which does not have a valid registry certificate, or one not using TLS. Insecure registries should not be used as they present a risk of traffic interception and modification.

Additionally, once a registry has been marked as insecure commands such as `docker pull`, `docker push`, and `docker search` will not result in an error message and users may indefinitely be working with this type of insecure registry without ever being notified of the risk of potential compromise.

## Impact
None.

## Audit Procedure

You should execute the command below to find out if any insecure registries are in use:

```bash
docker info --format 'Insecure Registries: {{.RegistryConfig.InsecureRegistryCIDRs}}'
```

## Remediation

You should ensure that no insecure registries are in use.

## Default Value
By default, Docker assumes all, but local, registries are secure.

## References
1. https://docs.docker.com/registry/insecure/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 2.5 Allowlist Authorized Software<br/>Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently. | | ● | ● |
| v7 | 14.4 Encrypt All Sensitive Information in Transit<br/>Encrypt all sensitive information in transit. | | ● | ● |

## Profile
**Level 1 - Docker - Linux** (Manual)
