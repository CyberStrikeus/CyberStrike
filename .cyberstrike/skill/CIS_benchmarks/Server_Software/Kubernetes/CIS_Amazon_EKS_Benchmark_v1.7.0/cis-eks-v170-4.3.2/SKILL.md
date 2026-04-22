---
name: cis-eks-v170-4.3.2
description: "Ensure that all Namespaces have Network Policies defined (Automated)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, network-policy, namespace, segmentation]
cis_id: "4.3.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.2 Ensure that all Namespaces have Network Policies defined (Automated)

## Profile Applicability

- Level 1

## Description

Use network policies to isolate traffic in your cluster network.

## Rationale

Running different applications on the same Kubernetes cluster creates a risk of one compromised application attacking a neighboring application. Network segmentation is important to ensure that containers can communicate only with those they are supposed to. A network policy is a specification of how selections of pods are allowed to communicate with each other and other network endpoints.

Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

## Impact

Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

## Audit Procedure

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

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 14.1 Segment the Network Based on Sensitivity | | x | x |
| v7 | 14.2 Enable Firewall Filtering Between VLANs | | x | x |
