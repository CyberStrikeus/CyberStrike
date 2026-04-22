---
name: cis-docker-7.6
description: "Ensure that the swarm manager auto-lock key is rotated periodically"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, swarm, orchestration, encryption, certificates]
cis_id: "7.6"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.6 Ensure that the swarm manager auto-lock key is rotated periodically (Manual)

## Profile Applicability

- Level 1 - Docker Swarm

## Description

You should rotate the swarm manager auto-lock key periodically.

## Rationale

The swarm manager auto-lock key is not automatically rotated. Good security practice is to rotate keys.

## Impact

None

## Audit Procedure

Currently, there is no mechanism to find out when the key was last rotated on a swarm manager node. You should check with the system administrator to see if there is a key rotation process, and how often the key is rotated.

## Remediation

You should run the command below to rotate the keys.

```
docker swarm unlock-key --rotate
```

Additionally, to facilitate auditing of this recommendation, you should maintain key rotation records and ensure that you establish a pre-defined frequency for key rotation.

## Default Value

By default, keys are not rotated automatically.

## References

1. https://docs.docker.com/engine/reference/commandline/swarm_unlock-key/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords<br>Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | ●    | ●    | ●    |
| v7               | 4.4 Use Unique Passwords<br>Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | ●    | ●    |
