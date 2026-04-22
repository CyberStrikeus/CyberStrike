---
name: cis-k8s-v200-1.2.13
description: "Ensure that the admission control plugin NamespaceLifecycle is set (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, admission-control, namespace-lifecycle]
cis_id: "1.2.13"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.13 Ensure that the admission control plugin NamespaceLifecycle is set (Automated)

## Profile Applicability

- Level 2 - Master Node

## Description

Reject creating objects in a namespace that is undergoing termination.

## Rationale

Setting admission control policy to `NamespaceLifecycle` ensures that objects cannot be created in non-existent namespaces, and that namespaces undergoing termination are not used for creating the new objects. This is recommended to enforce the integrity of the namespace termination process and also for the availability of the newer objects.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--disable-admission-plugins` argument is set to a value that does not include `NamespaceLifecycle`.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and set the `--disable-admission-plugins` parameter to ensure it does not include `NamespaceLifecycle`.

## Default Value

By default, `NamespaceLifecycle` is set.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
2. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#namespacelifecycle

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |
| v7 | 5.1 Establish Secure Configurations | * | * | * |
