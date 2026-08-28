---
name: cis-aks-v180-4.2.3
description: "Minimize the admission of containers wishing to share the host IPC namespace (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, pod-security, host-ipc, namespace-sharing, admission-control]
cis_id: "4.2.3"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.3 Minimize the admission of containers wishing to share the host IPC namespace (Manual)

## Profile Applicability

- Level 1

## Description

Do not generally permit containers to be run with the `hostIPC` flag set to true.

## Rationale

A container running in the host's IPC namespace can use IPC to interact with processes outside the container.

There should be at least one admission control policy defined which does not permit containers to share the host IPC namespace.

If you need to run containers which require hostIPC, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.hostIPC: true` will not be permitted unless they are run under a specific policy.

## Audit

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of `hostIPC` containers.

Search for the hostIPC Flag: In the YAML output, look for the `hostIPC` setting under the spec section to check if it is set to `true`.

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.spec.hostIPC == true) | "\(.metadata.namespace)/\(.metadata.name)"'
```

OR

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.spec.hostIPC == true) | select(.metadata.namespace != "kube-system" and .metadata.namespace != "gatekeeper-system" and .metadata.namespace != "azure-arc" and .metadata.namespace != "azure-extensions-usage-system") | "\(.metadata.name) \(.metadata.namespace)"'
```

When creating a Pod Security Policy, ["kube-system", "gatekeeper-system", "azure-arc", "azure-extensions-usage-system"] namespaces are excluded by default.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostIPC` containers.

Pod Security Policies and Assignments can be found by searching for Policies in the Azure Portal. A detailed step-by-step guide can be found here:

[https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes)

## Default Value

By default, there are no restrictions on the creation of `hostIPC` containers.

## References

1. [https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-for-kubernetes)
2. [https://kubernetes.io/docs/concepts/security/pod-security-admission/](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
3. [https://learn.microsoft.com/en-us/azure/aks/use-psa](https://learn.microsoft.com/en-us/azure/aks/use-psa)

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |
| v7               | 5.2 Maintain Secure Images                                |      | x    | x    |
