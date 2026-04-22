---
name: cis-k8s-v1111-4.1.7
description: "Ensure that the certificate authorities file permissions are set to 644 or more restrictive (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, configuration-files, permissions, ownership, kubelet, kubeconfig, certificates]
cis_id: "4.1.7"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
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

1. [https://kubernetes.io/docs/admin/authentication/#x509-client-certs](https://kubernetes.io/docs/admin/authentication/#x509-client-certs)

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
