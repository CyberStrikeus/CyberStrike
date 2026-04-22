---
name: cis-gke-autopilot-v130-4.3.1
description: "Ensure that all Namespaces have Network Policies defined (Automated)"
category: cis-gke-autopilot
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, network-policies, cni, network-segmentation]
cis_id: "4.3.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.3.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3.1 Ensure that all Namespaces have Network Policies defined (Automated)

## Profile Applicability

- Level 2

## Description

Use network policies to isolate traffic in the cluster network.

## Rationale

Running different applications on the same Kubernetes cluster creates a risk of one compromised application attacking a neighboring application. Network segmentation is important to ensure that containers can communicate only with those they are supposed to. A network policy is a specification of how selections of pods are allowed to communicate with each other and other network endpoints.

Network Policies are namespace scoped. When a network policy is introduced to a given namespace, all traffic not allowed by the policy is denied. However, if there are no network policies in a namespace all traffic will be allowed into and out of the pods in that namespace.

## Impact

Once network policies are in use within a given namespace, traffic not explicitly allowed by a network policy will be denied. As such it is important to ensure that, when introducing network policies, legitimate traffic is not blocked.

## Audit

Run the below command and review the `NetworkPolicy` objects created in the cluster.

```bash
kubectl get networkpolicy --all-namespaces

ensure that each namespace defined in the cluster has at least one Network Policy.
```

## Remediation

Follow the documentation and create `NetworkPolicy` objects as needed.
See: https://cloud.google.com/kubernetes-engine/docs/how-to/network-policy#creating_a_network_policy for more information.

## Default Value

By default, network policies are not created.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/network-policy#creating_a_network_policy
2. https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
3. https://cloud.google.com/kubernetes-engine/docs/concepts/network-overview

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.4 Perform Traffic Filtering Between Network Segments | | * | * |
| v7 | 14.1 Segment the Network Based on Sensitivity | | * | * |
| v7 | 14.2 Enable Firewall Filtering Between VLANs | | * | * |
