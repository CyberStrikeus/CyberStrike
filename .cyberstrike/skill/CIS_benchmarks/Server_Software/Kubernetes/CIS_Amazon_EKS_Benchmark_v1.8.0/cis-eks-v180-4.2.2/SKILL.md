---
name: cis-eks-v180-4.2.2
description: "Minimize the admission of containers wishing to share the host process ID namespace (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, pod-security, hostPID, namespace-sharing, pss]
cis_id: "4.2.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.2 Minimize the admission of containers wishing to share the host process ID namespace (Manual)

## Profile Applicability

- Level 1

## Description

Do not generally permit containers to be run with the `hostPID` flag set to true.

## Rationale

A container running in the host's PID namespace can inspect processes running outside the container. If the container also has access to ptrace capabilities this can be used to escalate privileges outside of the container.

There should be at least one admission control policy defined which does not permit containers to share the host PID namespace.

If you need to run containers which require hostPID, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostPID: true` will not be permitted unless they are run under a specific policy.

## Audit Procedure

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of `hostPID` containers.

Search for the hostPID Flag: In the YAML output, look for the `hostPID` setting under the spec section to check if it is set to `true`.

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.spec.hostPID == true) | "\(.metadata.namespace)/\(.metadata.name)"'
```

OR

```bash
kubectl get pods --all-namespaces -o json | jq '.items[] | select(.metadata.namespace != "kube-system" and .spec.hostPID == true) | {pod: .metadata.name, namespace: .metadata.namespace, container: .spec.containers[].name}'
```

When creating a Pod Security Policy, `["kube-system"]` namespaces are excluded by default.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostPID` containers.

## Default Value

By default, there are no restrictions on the creation of `hostPID` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | x | x | x |
