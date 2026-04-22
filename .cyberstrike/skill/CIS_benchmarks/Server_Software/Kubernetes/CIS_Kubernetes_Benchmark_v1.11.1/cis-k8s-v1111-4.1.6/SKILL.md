---
name: cis-k8s-v1111-4.1.6
description: "Ensure that the --kubeconfig kubelet.conf file ownership is set to root:root (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, configuration-files, permissions, ownership, kubelet, kubeconfig, certificates]
cis_id: "4.1.6"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.6 Ensure that the --kubeconfig kubelet.conf file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the `kubelet.conf` file ownership is set to `root:root`.

## Rationale

The `kubelet.conf` file is the kubeconfig file for the node, and controls various parameters that set the behavior and identity of the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None

## Audit

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet config file.
Please set `$kubelet_config=<PATH>` based on the file location on your system for example:

```bash
export kubelet_config=/etc/kubernetes/kubelet.conf
```

To perform the audit manually:
Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %U:%G /etc/kubernetes/kubelet.conf
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chown root:root /etc/kubernetes/kubelet.conf
```

## Default Value

By default, `kubelet.conf` file ownership is set to `root:root`.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
