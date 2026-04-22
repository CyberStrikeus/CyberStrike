---
name: cis-docker-v170-7.8
description: "Ensure that CA certificates are rotated as appropriate"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, swarm, ca-certificates, rotation]
cis_id: "7.8"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 7.8

## Profile Applicability

- **Level:** 1
- **Type:** Manual
- **Platform:** Docker Swarm

## Description

You should rotate root CA certificates as appropriate.

## Rationale

Docker Swarm uses TLS for clustering operations between its nodes. Certificate rotation ensures that in an event such as a compromised node or key, it is difficult to impersonate a node. Node certificates depend upon root CA certificates. For operational security, it is important to rotate these frequently. Currently, root CA certificates are not rotated automatically and you should therefore establish a process for rotating them in line with your organizational security policy.

## Impact

None

## Audit Procedure

You should check the time stamp on the root CA certificate file.

For example:

```bash
ls -l /var/lib/docker/swarm/certificates/swarm-root-ca.crt
```

The certificate should show a time stamp in line with the organizational rotation policy.

## Remediation

You should run the command below to rotate a certificate.

```bash
docker swarm ca --rotate
```

## Default Value

By default, root CA certificates are not rotated.

## References

1. https://docs.docker.com/engine/swarm/how-swarm-mode-works/pki/#rotating-the-ca-certificate

## CIS Controls

**v8:**

- **5.2 Use Unique Passwords**
  - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA.

**v7:**

- **4.4 Use Unique Passwords**
  - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.
