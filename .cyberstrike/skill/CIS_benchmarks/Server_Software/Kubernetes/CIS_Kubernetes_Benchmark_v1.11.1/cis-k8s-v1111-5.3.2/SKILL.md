---
name: cis-k8s-v1111-5.3.2
description: "Ensure that all Namespaces have Network Policies defined (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, network-policies, cni]
cis_id: "5.3.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2 Ensure that all Namespaces have Network Policies defined (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Use network policies to isolate traffic in your cluster network.

## Rationale

Running different applications on the same Kubernetes cluster creates a risk of one compromised application attacking a neighboring application. Network segmentation is important to ensure that containers can communicate only with those they are supposed to. A network policy is a specification of how selections of pods are allowed to communicate with each other and other network endpoints.

Network Policies are namespace scoped. When a network policy is introduced to a given namespace, all traffic not allowed by the policy is denied. However, if there are no network policies in a namespace all traffic will be allowed into and out of the pods in that namespace.

## Impact

Once network policies are in use within a given namespace, traffic not explicitly allowed by a network policy will be denied. As such it is important to ensure that, when introducing network policies, legitimate traffic is not blocked.

## Audit

Run the below command and review the `NetworkPolicy` objects created in the cluster.

```bash
kubectl get networkpolicy --all-namespaces
```

Ensure that each namespace defined in the cluster has at least one Network Policy.

## Remediation

Follow the documentation and create `NetworkPolicy` objects as you need them.

## Default Value

By default, network policies are not created.

## References

1. https://kubernetes.io/docs/concepts/services-networking/networkpolicies/
2. https://octetz.com/posts/k8s-network-policy-apis
3. https://kubernetes.io/docs/tasks/configure-pod-container/declare-network-policy/

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | X    | X    | X    |
| v7               | 14.2 Enable Firewall Filtering Between VLANs   |      | X    | X    |
