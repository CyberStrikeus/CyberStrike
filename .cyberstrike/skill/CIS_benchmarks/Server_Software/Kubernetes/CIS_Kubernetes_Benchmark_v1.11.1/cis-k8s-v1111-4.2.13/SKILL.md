---
name: cis-k8s-v1111-4.2.13
description: "Ensure that a limit is set on pod PIDs (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags:
  [
    cis,
    kubernetes,
    worker-nodes,
    kubelet,
    authentication,
    authorization,
    tls,
    streaming,
    iptables,
    hostname-override,
    event-capture,
    certificate-rotation,
    seccomp,
    strong-ciphers,
  ]
cis_id: "4.2.13"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.13 Ensure that a limit is set on pod PIDs (Manual)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that the Kubelet sets limits on the number of PIDs that can be created by pods running on the node.

## Rationale

By default pods running in a cluster can consume any number of PIDs, potentially exhausting the resources available on the node. Setting an appropriate limit reduces the risk of a denial of service attack on cluster nodes.

## Impact

Setting this value will restrict the number of processes per pod. If this limit is lower than the number of PIDs required by a pod it will not operate.

## Audit

Review the Kubelet's start-up parameters for the value of `--pod-max-pids`, and check the Kubelet configuration file for the `PodPidsLimit`. If neither of these values is set, then there is no limit in place.

## Remediation

Decide on an appropriate level for this parameter and set it, either via the `--pod-max-pids` command line parameter or the `PodPidsLimit` configuration file setting.

## Default Value

By default the number of PIDs is not limited.

## References

1. [https://kubernetes.io/docs/concepts/policy/pid-limiting/#pod-pid-limits](https://kubernetes.io/docs/concepts/policy/pid-limiting/#pod-pid-limits)

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running            |      | x    | x    |
