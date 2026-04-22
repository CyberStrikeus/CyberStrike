---
name: cis-k8s-v1120-1.1.14
description: "Ensure that the default administrative credential file ownership is set to root:root (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, admin-conf, credentials, ownership, level1]
cis_id: "1.1.14"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.14 Ensure that the default administrative credential file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the `admin.conf` (and `super-admin.conf` file, where it exists) file ownership is set to `root:root`.

## Rationale

As part of initial cluster setup, default kubeconfig files are created to be used by the administrator of the cluster. These files contain private keys and certificates which allow for privileged access to the cluster. You should set their file ownership to maintain the integrity and confidentiality of the file. The file(s) should be owned by `root:root`.

## Impact

None.

## Audit

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c %U:%G /etc/kubernetes/admin.conf
```

On Kubernetes version 1.29 and higher run the following command as well :-

```bash
stat -c %U:%G /etc/kubernetes/super-admin.conf
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chown root:root /etc/kubernetes/admin.conf
```

On Kubernetes 1.29+ the super-admin.conf file should also be modified, if present. For example,

```bash
chown root:root /etc/kubernetes/super-admin.conf
```

## Default Value

By default, `admin.conf` and `super-admin.conf` file ownership is set to `root:root`.

## References

1. [https://kubernetes.io/docs/admin/kubeadm/](https://kubernetes.io/docs/admin/kubeadm/)
2. [https://raesene.github.io/blog/2024/01/06/when-is-admin-not-admin/](https://raesene.github.io/blog/2024/01/06/when-is-admin-not-admin/)

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | \*   | \*   | \*   |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
