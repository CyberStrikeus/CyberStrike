---
name: cis-k8s-v1120-4.1.5
description: "Ensure that the --kubeconfig kubelet.conf file permissions are set to 600 or more restrictive (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, worker-node-config, file-permissions]
cis_id: "4.1.5"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.1.5

## Description

Ensure that the `kubelet.conf` file has permissions of `600` or more restrictive.

## Rationale

The `kubelet.conf` file is the kubeconfig file for the node, and controls various parameters that set the behavior and identity of the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit Procedure

### Step 1: Set the kubelet config variable

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet config file.

Please set `$kubelet_config=<PATH>` based on the file location on your system.

For example:

```bash
export kubelet_config=/etc/kubernetes/kubelet.conf
```

### Step 2: Verify file permissions

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

| Controls Version | Control                                                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists.                                              | ●    | ●    | ●    |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Automated
