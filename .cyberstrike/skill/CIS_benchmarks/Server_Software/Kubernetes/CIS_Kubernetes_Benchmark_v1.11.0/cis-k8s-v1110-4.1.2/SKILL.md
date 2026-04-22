---
name: cis-k8s-v1110-4.1.2
description: "Ensure that the kubelet service file ownership is set to root:root (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-ownership, kubelet-service]
cis_id: "4.1.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2 Ensure that the kubelet service file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the `kubelet` service file ownership is set to `root:root`.

## Rationale

The `kubelet` service file controls various parameters that set the behavior of the `kubelet` service in the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

None

## Audit

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet service config file.
Please set `$kubelet_service_config=<PATH>` based on the file location on your system for example:

```bash
export kubelet_service_config=/etc/systemd/system/kubelet.service.d/kubeadm.conf
```

To perform the audit manually:
Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %U:%G /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chown root:root /etc/systemd/system/kubelet.service.d/kubeadm.conf
```

## Default Value

By default, `kubelet` service file ownership is set to `root:root`.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#44-joining-your-nodes](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#44-joining-your-nodes)
3. [https://kubernetes.io/docs/admin/kubeadm/#kubelet-drop-in](https://kubernetes.io/docs/admin/kubeadm/#kubelet-drop-in)

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
