---
name: cis-gke-v180-4.6.3
description: "Apply Security Context to Pods and Containers (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, general-policies, namespaces, seccomp, security-context]
cis_id: "4.6.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6.3 Apply Security Context to Pods and Containers (Manual)

## Profile Applicability

- Level 2

## Description

Apply Security Context to Pods and Containers.

## Rationale

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc..) applied to a container. When designing containers and pods, make sure that the security context is configured for pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context, and container level security context.

## Impact

If you incorrectly apply security contexts, there may be issues running the pods.

## Audit

Review the pod definitions in the cluster and verify that the security contexts have been defined as appropriate.

## Remediation

Follow the Kubernetes documentation and apply security contexts to your pods. For a suggested list of security contexts, you may refer to the CIS Google Container-Optimized OS Benchmark.

## Default Value

By default, no security contexts are automatically applied to pods.

## References

1. https://kubernetes.io/docs/concepts/workloads/pods/
2. https://kubernetes.io/docs/concepts/containers/
3. https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
4. https://learn.cisecurity.org/benchmarks

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software |      |      |      |
| v7               | 5.1 Establish Secure Configurations                      | \*   | \*   | \*   |
