---
name: cis-k8s-v200-1.1.21
description: "Ensure that the Kubernetes PKI key file permissions are set to 600 (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, file-permissions, pki, private-keys]
cis_id: "1.1.21"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.21 Ensure that the Kubernetes PKI key file permissions are set to 600 (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that Kubernetes PKI key files have permissions of `600`.

## Rationale

Kubernetes makes use of a number of key files as part of the operation of its components. The permissions on these files should be set to `600` to protect their integrity and confidentiality.

## Impact

None

## Audit

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c '%a' /etc/kubernetes/pki/*.key
```

Verify that the permissions are `600` or more restrictive.

or

```bash
ls -l /etc/kubernetes/pki/*.key
```

Verify that the permissions are `-rw------`

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chmod -R 600 /etc/kubernetes/pki/*.key
```

## Default Value

By default, the keys used by Kubernetes are set to have permissions of `600`

## References

1. https://kubernetes.io/docs/admin/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | * | * | * |
