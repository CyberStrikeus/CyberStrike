---
name: cis-oke-v170-4.3.2
description: "Ensure that all Namespaces have Network Policies defined (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, cni-plugin]
cis_id: "4.3.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 4.3.2

## Profile Applicability
- **Level:** 1

## Description
Use network policies to isolate traffic in your cluster network.

## Rationale
Running different applications on the same Kubernetes cluster creates a risk of one compromised application attacking a neighboring application. Network segmentation is important to ensure that containers can communicate only with those they are supposed to. A network policy is a specification of how selections of pods are allowed to communicate with each other and other network endpoints.

Network Policies are namespace scoped. When a network policy is introduced to a given namespace, all traffic not allowed by the policy is denied. However, if there are no network policies in a namespace all traffic will be allowed into and out of the pods in that namespace.

## Impact
Once network policies are in use within a given namespace, traffic not explicitly allowed by a network policy will be denied. As such it is important to ensure that, when introducing network policies, legitimate traffic is not blocked.

## Audit Procedure
Run the below command and review the `NetworkPolicy` objects created in the cluster.

```bash
kubectl get networkpolicy --all-namespaces
```

Ensure that each namespace defined in the cluster has at least one Network Policy.

## Remediation
Follow the documentation and create `NetworkPolicy` objects as you need them.

Clusters you create with Container Engine for Kubernetes have flannel installed as the default CNI network provider. flannel is a simple overlay virtual network that satisfies the requirements of the Kubernetes networking model by attaching IP addresses to containers.

Although flannel satisfies the requirements of the Kubernetes networking model, it does not support NetworkPolicy resources. If you want to enhance the security of clusters you create with Container Engine for Kubernetes by implementing network policies, you have to install and configure a network provider that does support NetworkPolicy resources. One such provider is Calico (refer to the Kubernetes documentation for a list of other network providers). Calico is an open source networking and network security solution for containers, virtual machines, and native host-based workloads. Use the Calico open-source software in conjunction with flannel. The Calico Enterprise does not support flannel.

## Default Value
By default, network policies are not created.

## References
1. https://kubernetes.io/docs/concepts/services-networking/networkpolicies/
2. https://octetz.com/posts/k8s-network-policy-apis
3. https://kubernetes.io/docs/tasks/configure-pod-container/declare-network-policy/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.4 Implement and Manage a Firewall on Servers | * | * | * |
| v7 | 14.1 Segment the Network Based on Sensitivity | | * | * |
| v7 | 14.2 Enable Firewall Filtering Between VLANs | | * | * |
| v6 | 14.1 Implement Network Segmentation Based On Information Class | | | |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1046 | TA0007 | M1030, M1042 |

## Profile
**Level 1** (Automated)
