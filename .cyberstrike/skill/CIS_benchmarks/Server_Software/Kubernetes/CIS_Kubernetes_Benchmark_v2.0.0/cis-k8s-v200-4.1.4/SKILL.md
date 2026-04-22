---
name: cis-k8s-v200-4.1.4
description: "If proxy kubeconfig file exists ensure ownership is set to root:root (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-ownership, kube-proxy]
cis_id: "4.1.4"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.4 If proxy kubeconfig file exists ensure ownership is set to root:root (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

If `kube-proxy` is running, ensure that the file ownership of its kubeconfig file is set to `root:root`.

## Rationale

The kubeconfig file for `kube-proxy` controls various parameters for the `kube-proxy` service in the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

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
stat -c %U:%G <path><filename>
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chown root:root <proxy kubeconfig file>
```

## Default Value

By default, `proxy` file ownership is set to `root:root`.

## References

1. https://kubernetes.io/docs/admin/kube-proxy/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | * | * | * |
| v7 | 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges | | | |
