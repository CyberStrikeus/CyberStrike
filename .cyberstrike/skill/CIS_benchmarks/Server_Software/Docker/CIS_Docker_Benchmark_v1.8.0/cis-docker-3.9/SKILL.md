---
name: cis-docker-3.9
description: "Ensure that TLS CA certificate file ownership is set to root:root"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-files, file-permissions, ownership]
cis_id: "3.9"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that TLS CA certificate file ownership is set to root:root (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should verify that the TLS CA certificate file (the file that is passed along with the `--tlscacert` parameter) is individually owned and group owned by `root`.

## Rationale

The TLS CA certificate file should be protected from any tampering. It is used to authenticate the Docker server based on a given CA certificate. It must be therefore be individually owned and group owned by `root` to ensure that it cannot be modified by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the TLS CA certificate file is owned and group owned by `root`:

```bash
stat -c %U:%G <path to TLS CA certificate file> | grep -v root:root
```

The above command should return no results.

## Remediation

You should execute the following command:

```bash
chown root:root <path to TLS CA certificate file>
```

This sets the individual ownership and group ownership for the TLS CA certificate file to `root`.

## Default Value

By default, the ownership and group-ownership for TLS CA certificate file is correctly set to `root`.

## References

1. https://docs.docker.com/registry/insecure/
2. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges | | | |
