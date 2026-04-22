---
name: cis-k8s-v200-4.1.7
description: "Ensure that the certificate authorities file permissions are set to 644 or more restrictive (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-permissions, certificates]
cis_id: "4.1.7"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.7 Ensure that the certificate authorities file permissions are set to 644 or more restrictive (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the certificate authorities file has permissions of `644` or more restrictive.

## Rationale

The certificate authorities file controls the authorities used to validate API requests. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit

Run the following command:

```bash
ps -ef | grep kubelet
```

Find the file specified by the `--client-ca-file` argument.

Run the following command:

```bash
stat -c %a <filename>
```

Verify that the permissions are `644` or more restrictive.

## Remediation

Run the following command to modify the file permissions of the `--client-ca-file`

```bash
chmod 644 <filename>
```

## Default Value

By default no `--client-ca-file` is specified.

## References

1. https://kubernetes.io/docs/admin/authentication/#x509-client-certs

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | * | * | * |
