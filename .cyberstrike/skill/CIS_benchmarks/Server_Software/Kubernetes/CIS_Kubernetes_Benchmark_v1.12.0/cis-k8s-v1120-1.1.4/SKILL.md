---
name: cis-k8s-v1120-1.1.4
description: "Ensure that the controller manager pod specification file ownership is set to root:root (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, controller-manager, ownership, level1]
cis_id: "1.1.4"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.4 Ensure that the controller manager pod specification file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the controller manager pod specification file ownership is set to `root:root`.

## Rationale

The controller manager pod specification file controls various parameters that set the behavior of various components of the master node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None

## Audit

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c %U:%G /etc/kubernetes/manifests/kube-controller-manager.yaml
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chown root:root /etc/kubernetes/manifests/kube-controller-manager.yaml
```

## Default Value

By default, `kube-controller-manager.yaml` file ownership is set to `root:root`.

## References

1. [https://kubernetes.io/docs/admin/kube-controller-manager](https://kubernetes.io/docs/admin/kube-controller-manager)

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | \*   | \*   | \*   |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
