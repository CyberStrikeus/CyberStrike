---
name: cis-docker-7.7
description: "Ensure that node certificates are rotated as appropriate"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, swarm, orchestration, certificates]
cis_id: "7.7"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.7 Ensure that node certificates are rotated as appropriate (Manual)

## Profile Applicability

- Level 1 - Docker Swarm

## Description

You should rotate swarm node certificates in line with your organizational security policy.

## Rationale

Docker Swarm uses TLS for clustering operations between its nodes. Certificate rotation ensures that in an event such as a compromised node or key, it is difficult to impersonate a node. By default, node certificates are rotated every 90 days, but you should rotate them more often or as appropriate in your environment.

## Impact

None

## Audit Procedure

Run one of the commands below and ensure that the node certificate `Expiry Duration` is set as appropriate.

```
docker info | grep "Expiry Duration"
docker info --format 'NodeCertExpiry: {{ .Swarm.Cluster.Spec.CAConfig.NodeCertExpiry }}'
```

## Remediation

You should run the command to set the desired expiry time on the node certificate. For example:

```
docker swarm update --cert-expiry 48h
```

## Default Value

By default, node certificates are rotated automatically every 90 days.

## References

1. https://docs.docker.com/engine/reference/commandline/swarm_update/#examples

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords<br>Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | ●    | ●    | ●    |
| v7               | 4.4 Use Unique Passwords<br>Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | ●    | ●    |
