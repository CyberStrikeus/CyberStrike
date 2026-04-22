---
name: cis-docker-v170-3.13
description: "Ensure that the Docker server certificate key file ownership is set to root:root"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, daemon, files, permissions, ownership, tls, certificates, keys]
cis_id: "3.13"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 3.13

## Description

You should verify that the Docker server certificate key file (the file that is passed along with the `--tlskey` parameter) is individually owned and group owned by `root`.

## Rationale

The Docker server certificate key file should be protected from any tampering or unneeded reads/writes. As it holds the private key for the Docker server certificate, it must be individually owned and group owned by `root` to ensure that it cannot be accessed by less privileged users.

## Impact

None.

## Audit Procedure

You should execute the command below to verify that the Docker server certificate key file is individually owned and group owned by `root`:

```bash
stat -c %U:%G <path to Docker server certificate key file> | grep -v root:root
```

The command above should return no results.

## Remediation

You should execute the following command:

```bash
chown root:root <path to Docker server certificate key file>
```

This sets the individual ownership and group ownership for the Docker server certificate key file to `root`.

## Default Value

By default, the individual ownership and group ownership for the Docker server certificate key file is correctly set to `root`.

## References

1. https://docs.docker.com/registry/insecure/
2. https://docs.docker.com/engine/security/https/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile Applicability

- Level 1 - Docker - Linux

## Assessment Status

Manual
