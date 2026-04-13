---
name: cis-docker-v170-5.26
description: "Ensure that the container is restricted from acquiring additional privileges"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, privileges, no-new-privileges]
cis_id: "5.26"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.26

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

You should restrict the container from acquiring additional privileges via suid or sgid bits.

## Rationale

A process can set the `no_new_priv` bit in the kernel and this persists across forks, clones and execve. The `no_new_priv` bit ensures that the process and its child processes do not gain any additional privileges via suid or sgid bits. This reduces the danger associated with many operations because the possibility of subverting privileged binaries is lessened.

## Impact

The `no_new_priv` option prevents LSMs like SELinux from allowing processes to acquire new privileges

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: SecurityOpt={{ .HostConfig.SecurityOpt }}'
```

This command should return all the security options currently configured for containers. `no-new-privileges` should be one of them.

Note that the SecurityOpt response will be empty (i.e. `SecurityOpt=<no value>`) even if `"no-new-privileges": true` has been configured in the Docker daemon.json configuration file.

## Remediation

You should start your container with the options below:

```bash
docker run --rm -it --security-opt=no-new-privileges ubuntu bash
```

## Default Value

By default, new privileges are not restricted.

## References

1. https://docs.docker.com/engine/reference/run/#security-configuration
2. https://www.kernel.org/doc/Documentation/prctl/no_new_privs.txt

## CIS Controls

**v8:**
- **5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts**
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**v7:**
- **4 Controlled Use of Administrative Privileges**
  - Controlled Use of Administrative Privileges
