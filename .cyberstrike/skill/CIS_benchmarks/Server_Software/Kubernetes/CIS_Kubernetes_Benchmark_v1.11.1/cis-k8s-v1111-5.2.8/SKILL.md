---
name: cis-k8s-v1111-5.2.8
description: "Minimize the admission of containers with the NET_RAW capability (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, pod-security-standards, net-raw, capabilities]
cis_id: "5.2.8"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.8 Minimize the admission of containers with the NET_RAW capability (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers with the potentially dangerous NET_RAW capability.

## Rationale

Containers run with a default set of capabilities as assigned by the Container Runtime. By default this can include potentially dangerous capabilities. With Docker as the container runtime the NET_RAW capability is enabled which may be misused by malicious containers.

Ideally, all containers should drop this capability.

There should be at least one admission control policy defined which does not permit containers with the NET_RAW capability.

If you need to run containers with this capability, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods with containers which run with the NET_RAW capability will not be permitted.

## Audit

List the policies in use for each namespace in the cluster, ensure that at least one policy disallows the admission of containers with the `NET_RAW` capability.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of containers with the `NET_RAW` capability.

## Default Value

By default, there are no restrictions on the creation of containers with the `NET_RAW` capability.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/
2. https://www.nccgroup.trust/uk/our-research/abusing-privileged-and-unprivileged-linux-containers/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | X | X |
| v7 | 5.2 Maintain Secure Images | | X | X |
