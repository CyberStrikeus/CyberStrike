---
name: cis-k8s-v200-4.1.3
description: "If proxy kubeconfig file exists ensure permissions are set to 600 or more restrictive (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-permissions, kube-proxy]
cis_id: "4.1.3"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.3 If proxy kubeconfig file exists ensure permissions are set to 600 or more restrictive (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

If `kube-proxy` is running, and if it is using a file-based kubeconfig file, ensure that the proxy kubeconfig file has permissions of `600` or more restrictive.

## Rationale

The `kube-proxy` kubeconfig file controls various parameters of the `kube-proxy` service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

It is possible to run `kube-proxy` with the kubeconfig parameters configured as a Kubernetes ConfigMap instead of a file. In this case, there is no proxy kubeconfig file.

## Impact

None

## Audit

Find the kubeconfig file being used by `kube-proxy` by running the following command:

```bash
ps -ef | grep kube-proxy
```

If `kube-proxy` is running, get the kubeconfig file location from the `--kubeconfig` parameter.

To perform the audit:

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %a <path><filename>
```

Verify that a file is specified and it exists with permissions are `600` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chmod 600 <proxy kubeconfig file>
```

## Default Value

By default, proxy file has permissions of `640`.

## References

1. https://kubernetes.io/docs/admin/kube-proxy/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | \*   | \*   | \*   |
