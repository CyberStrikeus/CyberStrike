---
name: cis-docker-5.24
description: "Ensure that docker exec commands are not used with the user=root option"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime]
cis_id: "5.24"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.24 Ensure that docker exec commands are not used with the user=root option (Manual)

## Profile Applicability

- Level 2 - Docker - Linux

## Description

You should not use `docker exec` with the `--user=root` option.

## Rationale

Using the `--user=root` option in a `docker exec` command, executes it within the container as the root user. This could potentially be insecure, particularly when you are running containers with reduced capabilities or enhanced restrictions.

For example, if your container is running as a tomcat user (or any other non-root user), it would be possible to run a command through `docker exec` as `root` with the `--user=root` option. This could potentially be dangerous.

## Impact

None.

## Audit Procedure

If you have auditing enabled as recommended in Section 1, you can use the command below to filter out `docker exec` commands that use the `--user=root` option.

```
ausearch -k docker | grep exec | grep user
```

## Remediation

You should not use the `--user=root` option in `docker exec` commands.

## Default Value

By default, the `docker exec` command runs without the `--user` option.

## References

1. https://docs.docker.com/engine/reference/commandline/exec/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |
