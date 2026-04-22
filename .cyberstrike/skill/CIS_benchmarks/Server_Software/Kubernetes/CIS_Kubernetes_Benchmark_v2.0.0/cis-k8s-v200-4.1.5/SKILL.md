---
name: cis-k8s-v200-4.1.5
description: "Ensure that the --kubeconfig kubelet.conf file permissions are set to 600 or more restrictive (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-permissions, kubelet]
cis_id: "4.1.5"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.5 Ensure that the --kubeconfig kubelet.conf file permissions are set to 600 or more restrictive (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the `kubelet.conf` file has permissions of `600` or more restrictive.

## Rationale

The `kubelet.conf` file is the kubeconfig file for the node, and controls various parameters that set the behavior and identity of the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet config file.

Please set `$kubelet_config=<PATH><filename>` based on the file location on your system.

For example:

```bash
export kubelet_config=/etc/kubernetes/kubelet.conf
```

To perform the audit manually: Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %a /etc/kubernetes/kubelet.conf
```

Verify that the ownership is set to `root:root`. Verify that the permissions are `600` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chmod 600 /etc/kubernetes/kubelet.conf
```

## Default Value

By default, `kubelet.conf` file has permissions of `600`.

## References

1. https://kubernetes.io/docs/admin/kubelet/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | * | * | * |
