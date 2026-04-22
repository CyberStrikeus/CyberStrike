---
name: cis-k8s-v200-5.2.1
description: "Ensure that the cluster has at least one active policy control mechanism in place (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, policy-control, admission-controller]
cis_id: "5.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.1 Ensure that the cluster has at least one active policy control mechanism in place (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Every Kubernetes cluster should have at least one policy control mechanism in place to enforce the other requirements in this section. This could be the in-built Pod Security Admission controller, or a third party policy control system.

## Rationale

Without an active policy control mechanism, it is not possible to limit the use of containers with access to underlying cluster nodes, via mechanisms like privileged containers, or the use of hostPath volume mounts.

## Impact

Where policy control systems are in place, there is a risk that workloads required for the operation of the cluster may be stopped from running. Care is required when implementing admission control policies to ensure that this does not occur.

## Audit

Review the workloads deployed to the cluster to understand if Pod Security Admission or external admission control systems are in place.

## Remediation

Ensure that either Pod Security Admission or an external policy control system is in place for every namespace which contains user workloads.

## Default Value

By default, Pod Security Admission is enabled but no policies are in place.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission
