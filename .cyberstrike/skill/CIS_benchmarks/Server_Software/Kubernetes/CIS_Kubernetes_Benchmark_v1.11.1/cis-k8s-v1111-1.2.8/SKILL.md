---
name: cis-k8s-v1111-1.2.8
description: "Ensure that the --authorization-mode argument includes RBAC (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, authorization, rbac]
cis_id: "1.2.8"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.8 Ensure that the --authorization-mode argument includes RBAC (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Turn on Role Based Access Control.

## Rationale

Role Based Access Control (RBAC) allows fine-grained control over the operations that different entities can perform on different objects in the cluster. It is recommended to use the RBAC authorization mode.

## Impact

When RBAC is enabled you will need to ensure that appropriate RBAC settings (including Roles, RoleBindings and ClusterRoleBindings) are configured to allow appropriate access.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--authorization-mode` argument exists and is set to a value to include `RBAC`.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--authorization-mode` parameter to a value that includes `RBAC`, for example:

```bash
--authorization-mode=Node,RBAC
```

## Default Value

By default, `RBAC` authorization is not enabled.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/rbac/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
