---
name: cis-k8s-v1110-5.2.5
description: "Minimize the admission of containers wishing to share the host network namespace (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, host-network]
cis_id: "5.2.5"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.5 Minimize the admission of containers wishing to share the host network namespace (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers to be run with the `hostNetwork` flag set to true.

## Rationale

A container running in the host's network namespace could access the local loopback device, and could access network traffic to and from other pods.

There should be at least one admission control policy defined which does not permit containers to share the host network namespace.

If you need to run containers which require access to the host's network namespaces, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostNetwork: true` will not be permitted unless they are run under a specific policy.

## Audit

To fetch hostNetwork from each pod.

```bash
kubectl get pods -A -o=jsonpath=$'{range .items[*]}{@.metadata.name}: {@.spec.hostNetwork}\n{end}'
```

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostNetwork` containers.

## Default Value

By default, there are no restrictions on the creation of `hostNetwork` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/
