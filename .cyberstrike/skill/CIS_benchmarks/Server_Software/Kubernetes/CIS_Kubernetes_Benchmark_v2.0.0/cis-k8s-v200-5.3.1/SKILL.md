---
name: cis-k8s-v200-5.3.1
description: "Ensure that the CNI in use supports Network Policies (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, network-policies, cni, network-segmentation]
cis_id: "5.3.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1 Ensure that the CNI in use supports Network Policies (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

There are a variety of CNI plugins available for Kubernetes. If the CNI in use does not support Network Policies it may not be possible to effectively restrict traffic in the cluster.

## Rationale

Kubernetes network policies are enforced by the CNI plugin in use. As such it is important to ensure that the CNI plugin supports both Ingress and Egress network policies.

## Impact

None

## Audit

Review the documentation of CNI plugin in use by the cluster, and confirm that it supports Ingress and Egress network policies.

## Remediation

If the CNI plugin in use does not support network policies, consideration should be given to making use of a different plugin, or finding an alternate mechanism for restricting traffic in the Kubernetes cluster.

## Default Value

This will depend on the CNI plugin in use.

## References

1. https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/

## Additional Information

One example here is Flannel (https://github.com/coreos/flannel) which does not support Network policy unless Calico is also in use.
