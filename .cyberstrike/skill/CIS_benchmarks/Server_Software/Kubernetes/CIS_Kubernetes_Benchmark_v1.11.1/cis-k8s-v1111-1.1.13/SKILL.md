---
name: cis-k8s-v1111-1.1.13
description: "Ensure that the default administrative credential file permissions are set to 600 (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, configuration-files, permissions, kubeconfig, admin-credentials]
cis_id: "1.1.13"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.11.1 - Control 1.1.13

## Profile Applicability

- **Level:** 1 - Master Node

## Description

Ensure that the `admin.conf` file (and `super-admin.conf` file, where it exists) have permissions of `600`.

## Rationale

As part of initial cluster setup, default kubeconfig files are created to be used by the administrator of the cluster. These files contain private keys and certificates which allow for privileged access to the cluster. You should restrict their file permissions to maintain the integrity and confidentiality of the file(s). The file(s) should be readable and writable by only the administrators on the system.

## Impact

None.

## Audit

Run the following command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c %a /etc/kubernetes/admin.conf
```

On Kubernetes version 1.29 and higher run the following command as well:

```bash
stat -c %a /etc/kubernetes/super-admin.conf
```

Verify that the permissions are `600` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chmod 600 /etc/kubernetes/admin.conf
```

On Kubernetes 1.29+ the `super-admin.conf` file should also be modified, if present. For example,

```bash
chmod 600 /etc/kubernetes/super-admin.conf
```

## Default Value

By default, admin.conf and super-admin.conf have permissions of `600`.

## References

1. https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/
2. https://raesene.github.io/blog/2024/01/06/when-is-admin-not-admin/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |
