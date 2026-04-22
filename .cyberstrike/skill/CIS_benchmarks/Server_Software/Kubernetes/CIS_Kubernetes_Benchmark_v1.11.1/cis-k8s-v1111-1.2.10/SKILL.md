---
name: cis-k8s-v1111-1.2.10
description: "Ensure that the admission control plugin AlwaysAdmit is not set (Automated)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, admission-control, always-admit]
cis_id: "1.2.10"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.10 Ensure that the admission control plugin AlwaysAdmit is not set (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not allow all requests.

## Rationale

Setting admission control plugin `AlwaysAdmit` allows all requests and do not filter any requests.

The `AlwaysAdmit` admission controller was deprecated in Kubernetes v1.13. Its behavior was equivalent to turning off all admission controllers.

## Impact

Only requests explicitly allowed by the admissions control plugins would be served.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that if the `--enable-admission-plugins` argument is set, its value does not include `AlwaysAdmit`.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` on the Control Plane node and either remove the `--enable-admission-plugins` parameter, or set it to a value that does not include `AlwaysAdmit`.

## Default Value

`AlwaysAdmit` is not in the list of default admission plugins.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
2. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#alwaysadmit

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
