---
name: cis-k8s-v1120-1.1.13
description: "Ensure that the default administrative credential file permissions are set to 600 (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, admin-conf, credentials, permissions, level1]
cis_id: "1.1.13"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.13 Ensure that the default administrative credential file permissions are set to 600 (Automated)

## Profile Applicability

- Level 1 - Master Node

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

On Kubernetes version 1.29 and higher run the following command as well :-

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

1. [https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/](https://kubernetes.io/docs/setup/independent/create-cluster-kubeadm/)
2. [https://raesene.github.io/blog/2024/01/06/when-is-admin-not-admin/](https://raesene.github.io/blog/2024/01/06/when-is-admin-not-admin/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |
