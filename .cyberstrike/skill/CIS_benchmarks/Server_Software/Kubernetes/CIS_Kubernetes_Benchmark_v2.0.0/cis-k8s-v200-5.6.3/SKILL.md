---
name: cis-k8s-v200-5.6.3
description: "Apply Security Context to Your Pods and Containers (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, general-policies, security-context, pod-security, container-hardening]
cis_id: "5.6.3"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.3 Apply Security Context to Your Pods and Containers (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Apply Security Context to Your Pods and Containers.

## Rationale

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc..) applied to a container. When designing your containers and pods, make sure that you configure the security context for your pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context, and container level security context.

## Impact

If you incorrectly apply security contexts, you may have trouble running the pods.

## Audit

Review the pod definitions in your cluster and verify that you have security contexts defined as appropriate.

## Remediation

Follow the Kubernetes documentation and apply security contexts to your pods. For a suggested list of security contexts, you may refer to the CIS Security Benchmark for Docker Containers.

## Default Value

By default, no security contexts are automatically applied to pods.

## References

1. https://kubernetes.io/docs/concepts/policy/security-context/
2. https://learn.cisecurity.org/benchmarks
