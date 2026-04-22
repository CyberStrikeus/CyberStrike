---
name: cis-eks-v170-4.3.1
description: "Ensure CNI plugin supports network policies (Manual)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, cni, network-policy, calico, flannel]
cis_id: "4.3.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.1 Ensure CNI plugin supports network policies (Manual)

## Profile Applicability

- Level 1

## Description

There are a variety of CNI plugins available for Kubernetes. If the CNI in use does not support Network Policies it may not be possible to effectively restrict traffic in the cluster.

## Rationale

Kubernetes network policies are enforced by the CNI plugin in use. As such it is important to ensure that the CNI plugin supports both Ingress and Egress network policies.

## Impact

None.

## Audit Procedure

Review the documentation of CNI plugin in use by the cluster, and confirm that it supports network policies.

```bash
# Check which CNI plugin is in use
kubectl get pods -n kube-system -l k8s-app=aws-node -o wide
kubectl get daemonset -n kube-system aws-node -o yaml | grep image
```

## Remediation

As with RBAC policies, network policies should adhere to the policy of least privileged access. Start by creating a deny all policy that restricts all inbound and outbound traffic from a namespace or create a global policy using Calico.

## Default Value

This will depend on the CNI plugin in use.

## References

1. https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/
2. https://aws.github.io/aws-eks-best-practices/network/

## Additional Information

One example here is Flannel (https://github.com/coreos/flannel) which does not support Network policy unless Calico is also in use.

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management          | x    | x    | x    |
| v7               | 18.4 Only Use Up-to-date And Trusted Third-Party Components |      | x    | x    |
