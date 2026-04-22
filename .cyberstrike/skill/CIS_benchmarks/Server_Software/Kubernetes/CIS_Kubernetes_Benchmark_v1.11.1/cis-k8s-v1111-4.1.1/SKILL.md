---
name: cis-k8s-v1111-4.1.1
description: "Ensure that the kubelet service file permissions are set to 600 or more restrictive (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, configuration-files, permissions, ownership, kubelet, kubeconfig, certificates]
cis_id: "4.1.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1 Ensure that the kubelet service file permissions are set to 600 or more restrictive (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the `kubelet` service file has permissions of `600` or more restrictive.

## Rationale

The `kubelet` service file controls various parameters that set the behavior of the `kubelet` service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

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
stat -c %a /etc/systemd/system/kubelet.service.d/10-kubeadm.conf
```

Verify that the permissions are `600` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chmod 600 /etc/systemd/system/kubelet.service.d/kubeadm.conf
```

## Default Value

By default, the `kubelet` service file has permissions of `640`.

## References

1. [https://kubernetes.io/docs/admin/kubelet/](https://kubernetes.io/docs/admin/kubelet/)
2. [https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#44-joining-your-nodes](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/#44-joining-your-nodes)
3. [https://kubernetes.io/docs/admin/kubeadm/#kubelet-drop-in](https://kubernetes.io/docs/admin/kubeadm/#kubelet-drop-in)

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               |      | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
