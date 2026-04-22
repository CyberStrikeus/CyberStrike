---
name: cis-k8s-v1120-1.2.14
description: "Ensure that the admission control plugin NodeRestriction is set (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, admission-control, node-restriction]
cis_id: "1.2.14"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.14 Ensure that the admission control plugin NodeRestriction is set (Automated)

## Profile Applicability

- Level 2 - Master Node

## Description

Limit the `Node` and `Pod` objects that a kubelet could modify.

## Rationale

Using the `NodeRestriction` plug-in ensures that the kubelet is restricted to the `Node` and `Pod` objects that it could modify as defined. Such kubelets will only be allowed to modify their own `Node` API object, and only modify `Pod` API objects that are bound to their node.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--enable-admission-plugins` argument is set to a value that includes `NodeRestriction`.

## Remediation

Follow the Kubernetes documentation and configure `NodeRestriction` plug-in on kubelets. Then, edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the master node and set the `--enable-admission-plugins` parameter to a value that includes `NodeRestriction`.

```
--enable-admission-plugins=...,NodeRestriction,...
```

## Default Value

By default, `NodeRestriction` is not set.

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
2. [https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#noderestriction](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#noderestriction)
3. [https://kubernetes.io/docs/reference/access-authn-authz/node/](https://kubernetes.io/docs/reference/access-authn-authz/node/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 13.10 Perform Application Layer Filtering | | | * |
| v7 | 12.9 Deploy Application Layer Filtering Proxy Server | | | * |
