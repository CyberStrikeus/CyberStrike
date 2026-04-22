---
name: cis-k8s-v200-1.1.20
description: "Ensure that the Kubernetes PKI certificate file permissions are set to 644 or more restrictive (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, file-permissions, pki, certificates]
cis_id: "1.1.20"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.20 Ensure that the Kubernetes PKI certificate file permissions are set to 644 or more restrictive (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that Kubernetes PKI certificate files have permissions of `644` or more restrictive.

## Rationale

Kubernetes makes use of a number of certificate files as part of the operation of its components. The permissions on these files should be set to `644` or more restrictive to protect their integrity and confidentiality.

## Impact

None

## Audit

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
stat -c '%a' /etc/kubernetes/pki/*.crt
```

Verify that the permissions are `644` or more restrictive.

or

```bash
ls -l /etc/kubernetes/pki/*.crt
```

Verify -rw------

## Remediation

Run the below command (based on the file location on your system) on the Control Plane node. For example,

```bash
chmod -R 644 /etc/kubernetes/pki/*.crt
```

## Default Value

By default, the certificates used by Kubernetes are set to have permissions of `644`

## References

1. https://kubernetes.io/docs/admin/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | * | * | * |
| v7 | 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges | | | |
