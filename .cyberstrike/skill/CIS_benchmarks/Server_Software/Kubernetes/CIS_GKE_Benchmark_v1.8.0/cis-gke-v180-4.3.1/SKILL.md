---
name: cis-gke-v180-4.3.1
description: "Ensure that the CNI in use supports Network Policies (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, network-policies, cni]
cis_id: "4.3.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.1 Ensure that the CNI in use supports Network Policies (Manual)

## Profile Applicability

- Level 1

## Description

There are a variety of CNI plugins available for Kubernetes. If the CNI in use does not support Network Policies it may not be possible to effectively restrict traffic in the cluster.

## Rationale

Kubernetes network policies are enforced by the CNI plugin in use. As such it is important to ensure that the CNI plugin supports both Ingress and Egress network policies.

See also recommendation 5.6.7.

## Impact

None

## Audit

Review the documentation of CNI plugin in use by the cluster, and confirm that it supports Ingress and Egress network policies.

## Remediation

To use a CNI plugin with Network Policy, enable Network Policy in GKE, and the CNI plugin will be updated. See recommendation 5.6.7.

## Default Value

This will depend on the CNI plugin in use.

## References

1. https://kubernetes.io/docs/concepts/services-networking/network-policies/
2. https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/
3. https://cloud.google.com/kubernetes-engine/docs/concepts/network-overview

## Additional Information

One example here is Flannel (https://github.com/flannel-io/flannel) which does not support Network policy unless Calico is also in use.

## CIS Controls

| Controls Version | Control                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.5 Use Up-to-Date and Trusted Third-Party Software Components |      | \*   | \*   |
| v7               | 18.4 Only Use Up-to-date And Trusted Third-Party Components     |      | \*   | \*   |
