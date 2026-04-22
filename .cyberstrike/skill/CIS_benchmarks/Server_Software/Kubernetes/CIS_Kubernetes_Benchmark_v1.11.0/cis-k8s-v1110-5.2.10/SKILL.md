---
name: cis-k8s-v1110-5.2.10
description: "Minimize the admission of containers with capabilities assigned (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, capabilities-assigned]
cis_id: "5.2.10"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.10 Minimize the admission of containers with capabilities assigned (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Do not generally permit containers with capabilities.

## Rationale

Containers run with a default set of capabilities as assigned by the Container Runtime. Capabilities are parts of the rights generally granted on a Linux system to the root user.

In many cases applications running in containers do not require any capabilities to operate, so from the perspective of the principal of least privilege use of capabilities should be minimized.

## Impact

Pods with containers require capabilities to operate will not be permitted.

## Audit

List the policies in use for each namespace in the cluster, ensure that at least one policy requires that capabilities are dropped by all containers.

## Remediation

Review the use of capabilities in applications running on your cluster. Where a namespace contains applications which do not require any Linux capabilities to operate consider adding a policy which forbids the admission of containers which do not drop all capabilities.

## Default Value

By default, there are no restrictions on the creation of containers with additional capabilities.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/
2. https://www.nccgroup.trust/uk/our-research/abusing-privileged-and-unprivileged-linux-containers/
