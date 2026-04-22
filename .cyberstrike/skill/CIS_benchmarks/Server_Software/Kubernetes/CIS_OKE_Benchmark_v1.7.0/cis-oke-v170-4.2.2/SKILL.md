---
name: cis-oke-v170-4.2.2
description: "Minimize the admission of containers wishing to share the host process ID namespace (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, pod-security]
cis_id: "4.2.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 4.2.2

## Profile Applicability

- **Level:** 1

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

When creating a Pod Security Policy, ["kube-system"] namespaces are excluded by default.

This command retrieves all pods across all namespaces in JSON format, then uses jq to filter out those with the `hostPID` flag set to `true`, and finally formats the output to show the namespace and name of each matching pod.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostPID` containers.

## Default Value

By default, there are no restrictions on the creation of `hostPID` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission/
2. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.10 Perform Application Layer Filtering            |      |      | \*   |
| v7               | 12.9 Deploy Application Layer Filtering Proxy Server |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1078.002            | TA0001, TA0004 | M1026       |

## Profile

**Level 1** (Automated)
