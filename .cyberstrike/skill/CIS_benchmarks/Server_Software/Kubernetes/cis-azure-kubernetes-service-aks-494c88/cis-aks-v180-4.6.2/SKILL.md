---
name: cis-aks-v180-4.6.2
description: "Apply Security Context to Your Pods and Containers (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, security-context, pod-security, hardening]
cis_id: "4.6.2"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6.2 Apply Security Context to Your Pods and Containers (Manual)

## Profile Applicability

- Level 2

## Description

Apply Security Context to Your Pods and Containers.

## Rationale

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc.) applied to a container. When designing your containers and pods, make sure that you configure the security context for your pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context, and container level security context.

## Impact

If you incorrectly apply security contexts, you may have trouble running the pods.

## Audit Procedure

Review the pod definitions in your cluster and verify that you have security contexts defined as appropriate.

```bash
kubectl get pods --all-namespaces -o json | jq '.items[] | select(.spec.securityContext == {} or .spec.securityContext == null) | .metadata.namespace + "/" + .metadata.name'
```

## Remediation

As a best practice we recommend that you scope the binding for privileged pods to service accounts within a particular namespace, e.g. kube-system, and limiting access to that namespace. For all other serviceaccounts/namespaces, we recommend implementing a more restrictive policy that prevents pods from running as privileged or escalating privileges.

## Default Value

By default, no security contexts are automatically applied to pods.

## References

1. https://kubernetes.io/docs/concepts/policy/security-context/
2. https://learn.cisecurity.org/benchmarks
3. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.6 Securely Manage Enterprise Assets and Software                                                    | ●    | ●    | ●    |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## Profile Applicability

- Level 2
