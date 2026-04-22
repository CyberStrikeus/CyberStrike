---
name: cis-aks-v180-4.2.4
description: "Minimize the admission of containers wishing to share the host network namespace (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, pod-security, host-network, namespace-sharing, admission-control]
cis_id: "4.2.4"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.4 Minimize the admission of containers wishing to share the host network namespace (Manual)

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
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.spec.hostNetwork == true) | "\(.metadata.namespace)/\(.metadata.name)"'
```

OR

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.spec.hostNetwork == true) | select(.metadata.namespace != "kube-system" and .metadata.namespace != "gatekeeper-system" and .metadata.namespace != "azure-arc" and .metadata.namespace != "azure-extensions-usage-system") | "\(.metadata.name) \(.metadata.namespace)"'
```

When creating a Pod Security Policy, ["kube-system", "gatekeeper-system", "azure-arc", "azure-extensions-usage-system"] namespaces are excluded by default.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostNetwork` containers.

Pod Security Policies and Assignments can be found by searching for Policies in the Azure Portal. A detailed step-by-step guide can be found here:

[https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes)

## Default Value

By default, there are no restrictions on the creation of `hostNetwork` containers.

## References

1. [https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes)
2. [https://learn.microsoft.com/en-us/azure/aks/use-azure-policy](https://learn.microsoft.com/en-us/azure/aks/use-azure-policy)
3. [https://learn.microsoft.com/en-us/azure/aks/use-psa](https://learn.microsoft.com/en-us/azure/aks/use-psa)

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 5.2 Maintain Secure Images                                |      | x    | x    |
