---
name: cis-k8s-v1110-1.2.9
description: "Ensure that the admission control plugin EventRateLimit is set (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, api-server, admission-plugins, event-rate-limit, rate-limiting]
cis_id: "1.2.9"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.9 Ensure that the admission control plugin EventRateLimit is set (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Limit the rate at which the API server accepts requests.

## Rationale

Using `EventRateLimit` admission control enforces a limit on the number of events that the API Server will accept in a given time slice. A misbehaving workload could overwhelm and DoS the API Server, making it unavailable. This particularly applies to a multi-tenant cluster, where there might be a small percentage of misbehaving tenants which could have a significant impact on the performance of the cluster overall. Hence, it is recommended to limit the rate of events that the API server will accept.

## Impact

You need to carefully tune in limits as per your environment.

## Audit

Run the following command on the Control Plane node:

```bash
ps -ef | grep kube-apiserver
```

Verify that the `--enable-admission-plugins` argument is set to a value that includes `EventRateLimit`.

## Remediation

Follow the Kubernetes documentation and set the desired limits in a configuration file. Then, edit the API server pod specification file `/etc/kubernetes/manifests/kube-apiserver.yaml` and set the below parameters.

```
--enable-admission-plugins=...,EventRateLimit,...
--admission-control-config-file=<path/to/configuration/file>
```

## Default Value

By default, `EventRateLimit` is not set.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
2. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#eventratelimit
3. https://github.com/staebler/community/blob/9873b632f4d99b5d99c38c9b15fe2f8b93d0a746/contributors/design-proposals/admission_control_event_rate_limit.md

## CIS Controls

| Controls Version | Control                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components           |      | \*   | \*   |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies |      | \*   | \*   |
