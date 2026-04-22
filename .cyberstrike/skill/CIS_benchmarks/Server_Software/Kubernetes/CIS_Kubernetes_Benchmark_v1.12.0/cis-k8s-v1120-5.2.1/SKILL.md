---
name: cis-k8s-v1120-5.2.1
description: "Ensure that the cluster has at least one active policy control mechanism in place (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security]
cis_id: "5.2.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
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

## Audit Procedure

Review the workloads deployed to the cluster to understand if Pod Security Admission or external admission control systems are in place.

## Remediation

Ensure that either Pod Security Admission or an external policy control system is in place for every namespace which contains user workloads.

## Default Value

By default, Pod Security Admission is enabled but no policies are in place.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments |      | X    | X    |
| v8               | 13.10 Perform Application Layer Filtering               |      |      | X    |
| v7               | 4.7 Limit Access to Script Tools                        |      | X    | X    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering        | X    | X    | X    |
