---
name: cis-gke-autopilot-v100-4.2.1
description: "Ensure that the cluster enforces Pod Security Standard Baseline profile or stricter for all namespaces (Manual)"
category: cis-gke-autopilot
version: "1.0.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, pod-security, admission-control, pod-security-standards]
cis_id: "4.2.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.0.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.1 Ensure that the cluster enforces Pod Security Standard Baseline profile or stricter for all namespaces. (Manual)

## Profile Applicability

- Level 1

## Description

The Pod Security Standard Baseline profile defines a baseline for container security. You can enforce this by using the built-in Pod Security Admission controller.

## Rationale

Without an active mechanism to enforce the Pod Security Standard Baseline profile, it is not possible to limit the use of containers with access to underlying cluster nodes, via mechanisms like privileged containers, or the use of hostPath volume mounts.

## Audit

Run the following command to list the namespaces that don't have the baseline policy enforced.

```bash
diff \
<(kubectl get namespace -l pod-security.kubernetes.io/enforce=baseline -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}') \
<(kubectl get namespace -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}')
```

## Remediation

Ensure that Pod Security Admission is in place for every namespace which contains user workloads.
Run the following command to enforce the Baseline profile in a namespace:

```bash
kubectl label namespace <namespace-name> pod-security.kubernetes.io/enforce=baseline
```

## Default Value

By default, Pod Security Admission is enabled but no policies are in place.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission
2. https://kubernetes.io/docs/concepts/security/pod-security-standards
3. https://cloud.google.com/kubernetes-engine/docs/concepts/about-security-posture-dashboard

## CIS Controls

| Controls Version | Control                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure |      | \*   | \*   |
| v7               | 5.1 Establish Secure Configurations                                                | \*   | \*   | \*   |
| v7               | 5.2 Maintain Secure Images                                                         |      | \*   | \*   |
