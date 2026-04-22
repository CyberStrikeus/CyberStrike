---
name: cis-docker-5.23
description: "Ensure that docker exec commands are not used with the privileged option"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime]
cis_id: "5.23"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.23 Ensure that docker exec commands are not used with the privileged option (Manual)

## Profile Applicability

- Level 2 - Docker - Linux

## Description

You should not use `docker exec` with the `--privileged` option.

## Rationale

Using the `--privileged` option in `docker exec` commands gives extended Linux capabilities to the command. This could potentially be an insecure practice, particularly when you are running containers with reduced capabilities or with enhanced restrictions.

## Impact

If you need enhanced capabilities within a container, then run it with all the permissions it requires. These should be specified individually.

## Audit Procedure

If you have auditing enabled as recommended in Section 1, you can use the command below to filter out `docker exec` commands that use the `--privileged` option.

```
ausearch -k docker | grep exec | grep privileged
```

## Remediation

You should not use the `--privileged` option in `docker exec` commands.

## Default Value

By default, the `docker exec` command runs without the `--privileged` option.

## References

1. https://docs.docker.com/engine/reference/commandline/exec/
2. https://docs.docker.com/engine/reference/run/#runtime-privilege-and-linux-capabilities

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |
