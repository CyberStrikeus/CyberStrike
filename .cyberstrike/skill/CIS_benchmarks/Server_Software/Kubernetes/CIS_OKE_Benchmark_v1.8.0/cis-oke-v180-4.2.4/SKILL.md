---
name: cis-oke-v180-4.2.4
description: "Minimize the admission of containers wishing to share the host network namespace (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, pod-security]
cis_id: "4.2.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.4 Minimize the admission of containers wishing to share the host network namespace (Automated)

## Profile Applicability

- Level 1

## Description

Do not generally permit containers to be run with the `hostNetwork` flag set to true.

## Rationale

A container running in the host's network namespace could access the local loopback device, and could access network traffic to and from other pods.

There should be at least one admission control policy defined which does not permit containers to share the host network namespace.

If you need to run containers which require access to the host's network namespaces, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostNetwork: true` will not be permitted unless they are run under a specific policy.

## Audit

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of `hostNetwork` containers.

Given that manually checking each pod can be time-consuming, especially in large environments, you can use a more automated approach to filter out pods where `hostNetwork` is set to `true`. Here's a command using kubectl and jq:

```bash
kubectl get pods -A -o json \
| jq -r '
  .items[]
  | select((.spec.hostNetwork // false) == true)
  | "\(.metadata.namespace)/\(.metadata.name)\thostNetwork=true"
'
```

OR to include node info:

```bash
kubectl get pods -A -o json \
| jq -r '
  .items[]
  | select((.spec.hostNetwork // false) == true)
  | "\(.metadata.namespace)/\(.metadata.name)\tnode=\(.spec.nodeName // "-")\thostNetwork=true"
'
```

When creating a Pod Security Policy, ["kube-system"] namespaces are excluded by default.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostNetwork` containers.

## Default Value

By default, there are no restrictions on the creation of `hostNetwork` containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission/
2. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | x | x |
| v7 | 14.1 Segment the Network Based on Sensitivity | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1098 | TA0003 | M1030 |
