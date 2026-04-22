---
name: cis-k8s-v1120-1.2.30
description: "Ensure that the --service-account-extend-token-expiration parameter is set to false (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, authentication, service-account, token-expiration]
cis_id: "1.2.30"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.30 Ensure that the --service-account-extend-token-expiration parameter is set to false (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

By default Kubernetes extends service account token lifetimes to one year to aid in transition from the legacy token settings.

## Rationale

This default setting is not ideal for security as it ignores other settings related to maximum token lifetime and means that a lost or stolen credential could be valid for an extended period of time.

## Impact

Disabling this setting means that the service account token expiry set in the cluster will be enforced, and service account tokens will expire at the end of that time frame.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the --service-account-extend-token-expiration argument is set to false.

## Remediation

Edit the API server pod specification file /etc/kubernetes/manifests/kube-apiserver.yaml on the Control Plane node and set the --service-account-extend-token-expiration parameter to false.

```
--service-account-extend-token-expiration=false
```

## Default Value

By default, this parameter is set to true

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software |      |      |      |
| v7               | 5.1 Establish Secure Configurations                      | \*   | \*   | \*   |
