---
name: cis-eks-v180-5.4.4
description: "Ensure AmazonEKSNetworkingPolicy is Enabled and set as appropriate (Automated)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, network-policy, calico, zero-trust]
cis_id: "5.4.4"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.4 Ensure AmazonEKSNetworkingPolicy is Enabled and set as appropriate (Automated)

## Profile Applicability

- Level 1

## Description

**AmazonEKSNetworkingPolicy** is an AWS-managed add-on that provides native support for Kubernetes NetworkPolicy enforcement within Amazon Elastic Kubernetes Service (EKS) clusters. It enables organizations to define and apply fine-grained, pod-level network access controls that regulate traffic between workloads and external endpoints. Built on an AWS-optimized implementation of Calico, the add-on integrates seamlessly with the EKS control plane to deliver a secure and scalable approach to network segmentation without requiring manual CNI plugin installation.

## Rationale

By default, all pod to pod traffic within a cluster is allowed. Network Policy creates a pod-level firewall that can be used to restrict traffic between sources. Implementing AmazonEKSNetworkingPolicy provides significant security and operational benefits by introducing native, AWS-managed enforcement of Kubernetes NetworkPolicies, enabling fine-grained pod-level network segmentation and reducing the risk of lateral movement.

## Impact

Enabling Network Policy enforcement consumes additional resources in nodes. Specifically, it increases the memory footprint of the kube-system process by approximately 128MB, and requires approximately 300 millicores of CPU.

## Audit Procedure

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-addon --cluster-name ${CLUSTER_NAME} --addon-name vpc-cni --query addon.configurationValues
```

Output should read: `"{\"enableNetworkPolicy\":\"true\"}"`

## Remediation

Make sure Amazon VPC CNI is added and vpc-cni is active and upgraded to appropriate version in clusters Add-Ons:

```bash
aws eks update-addon --cluster-name $CLUSTER_NAME --addon-name vpc-cni --configuration-values '{"enableNetworkPolicy":"true"}'
```

## Default Value

By default, Network Policy is disabled.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/eks-networking-add-ons.html

## CIS Controls

| Controls Version | Control                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.1 Centralize Security Event Alerting       |      | ●    | ●    |
| v7               | 14.1 Segment the Network Based on Sensitivity |      |      | ●    |

## Profile Applicability

- Level 1
