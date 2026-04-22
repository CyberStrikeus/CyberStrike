---
name: cis-k8s-v200-1.2.20
description: "Ensure that the --request-timeout argument is set as appropriate (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, request-timeout, availability]
cis_id: "1.2.20"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.20 Ensure that the --request-timeout argument is set as appropriate (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Set global request timeout for API server requests as appropriate.

## Rationale

Setting global request timeout allows extending the API server request timeout limit to a duration appropriate to the user's connection speed. By default, it is set to 60 seconds which might be problematic on slower connections making cluster resources inaccessible once the data volume for requests exceeds what can be transmitted in 60 seconds. But, setting this timeout limit to be too large can exhaust the API server resources making it prone to Denial-of-Service attack. Hence, it is recommended to set this limit as appropriate and change the default limit of 60 seconds only if needed.

## Impact

None

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--request-timeout` argument is either not set or set to an appropriate value.

## Remediation

Edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` and set the below parameter as appropriate and if needed. For example,

```
--request-timeout=300s
```

## Default Value

By default, `--request-timeout` is set to 60 seconds.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
2. https://github.com/kubernetes/kubernetes/pull/51415

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |
| v7 | 5.1 Establish Secure Configurations | * | * | * |
