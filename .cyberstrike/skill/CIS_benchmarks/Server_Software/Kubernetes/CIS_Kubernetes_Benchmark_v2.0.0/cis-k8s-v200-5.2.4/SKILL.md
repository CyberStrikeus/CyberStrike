---
name: cis-k8s-v200-5.2.4
description: "Minimize the admission of containers wishing to share the host IPC namespace (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, hostipc, namespace-sharing]
cis_id: "5.2.4"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.4 Minimize the admission of containers wishing to share the host IPC namespace (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers to be run with the `hostIPC` flag set to true.

## Rationale

A container running in the host's IPC namespace can use IPC to interact with processes outside the container.

There should be at least one admission control policy defined which does not permit containers to share the host IPC namespace.

If you need to run containers which require hostIPC, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostIPC: true` will not be permitted unless they are run under a specific policy.

## Audit

To fetch hostIPC from each pod:

```bash
kubectl get pods -A -o=jsonpath=$'{range .items[*]}{@.metadata.name}: {@.spec.hostIPC}\n{end}'
```

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostIPC` containers.

## Default Value

By default, there are no restrictions on the creation of `hostIPC` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/
