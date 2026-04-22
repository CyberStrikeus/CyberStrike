---
name: cis-aks-v170-4.4.1
description: "Ensure latest CNI version is used (Manual)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, cni, network-plugin, network-policy]
cis_id: "4.4.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4.1 Ensure latest CNI version is used (Manual)

## Profile Applicability

- Level 1

## Description

There are a variety of CNI plugins available for Kubernetes. If the CNI in use does not support Network Policies it may not be possible to effectively restrict traffic in the cluster.

## Rationale

Kubernetes network policies are enforced by the CNI plugin in use. As such it is important to ensure that the CNI plugin supports both Ingress and Egress network policies.

## Impact

None.

## Audit

Ensure CNI plugin supports network policies.

Set Environment Variables to run:

```bash
export RESOURCE_GROUP=Resource Group Name
export CLUSTER_NAME=Cluster Name
```

Azure command to check for CNI plugin:

```bash
az aks show --resource-group ${RESOURCE_GROUP} --name ${CLUSTER_NAME} --query "networkProfile"
```

## Remediation

As with RBAC policies, network policies should adhere to the policy of least privileged access. Start by creating a deny all policy that restricts all inbound and outbound traffic from a namespace or create a global policy using Cilium or Calico.

## Default Value

This will depend on the CNI plugin in use.

## References

1. [https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/)
2. [https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-network-security#ns-1-implement-security-for-internal-traffic](https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-network-security#ns-1-implement-security-for-internal-traffic)
3. [https://learn.microsoft.com/en-us/azure/aks/use-network-policies](https://learn.microsoft.com/en-us/azure/aks/use-network-policies)

## Additional Information

One example here is Flannel (https://github.com/coreos/flannel) which does not support Network policy unless Calico is also in use.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.5 Use Up-to-Date and Trusted Third-Party Software Components | | x | x |
| v7 | 18.4 Only Use Up-to-date And Trusted Third-Party Components | | x | x |
