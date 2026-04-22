---
name: cis-k8s-v1111-5.2.3
description: "Minimize the admission of containers wishing to share the host process ID namespace (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, pod-security-standards, host-pid]
cis_id: "5.2.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.3 Minimize the admission of containers wishing to share the host process ID namespace (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers to be run with the `hostPID` flag set to true.

## Rationale

A container running in the host's PID namespace can inspect processes running outside the container. If the container also has access to ptrace capabilities this can be used to escalate privileges outside of the container.

There should be at least one admission control policy defined which does not permit containers to share the host PID namespace.

If you need to run containers which require hostPID, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostPID: true` will not be permitted unless they are run under a specific policy.

## Audit

Fetch hostPID from each pod with:

```bash
kubectl get pods -A -o=jsonpath=$'{range .items[*]}{@.metadata.name}: {@.spec.hostPID}\n{end}'
```

## Remediation

Configure the Admission Controller to restrict the admission of `hostPID` containers.

## Default Value

By default, there are no restrictions on the creation of `hostPID` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.10 Perform Application Layer Filtering | | | X |
| v7 | 12.9 Deploy Application Layer Filtering Proxy Server | | | X |
