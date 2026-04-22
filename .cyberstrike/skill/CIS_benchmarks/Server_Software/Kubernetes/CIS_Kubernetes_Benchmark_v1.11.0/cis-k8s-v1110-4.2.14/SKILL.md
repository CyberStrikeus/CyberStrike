---
name: cis-k8s-v1110-4.2.14
description: "Ensure that the --seccomp-default parameter is set to true (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, kubelet, seccomp-default, container-security]
cis_id: "4.2.14"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.14 Ensure that the --seccomp-default parameter is set to true (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the Kubelet enforces the use of the RuntimeDefault seccomp profile

## Rationale

By default, Kubernetes disables the seccomp profile which ships with most container runtimes. Setting this parameter will ensure workloads running on the node are protected by the runtime's seccomp profile.

## Impact

Setting this will remove some rights from pods running on the node.

## Audit

Review the Kubelet's start-up parameters for the value of `--seccomp-default`, and check the Kubelet configuration file for the `seccompDefault`. If neither of these values is set, then the seccomp profile is not in use.

## Remediation

Set the parameter, either via the `--seccomp-default` command line parameter or the `seccompDefault` configuration file setting.

## Default Value

By default the seccomp profile is not enabled.

## References

1. [https://kubernetes.io/docs/tutorials/security/seccomp/#enable-the-use-of-runtimedefault-as-the-default-seccomp-profile-for-all-workloads](https://kubernetes.io/docs/tutorials/security/seccomp/#enable-the-use-of-runtimedefault-as-the-default-seccomp-profile-for-all-workloads)
