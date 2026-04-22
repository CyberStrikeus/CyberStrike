---
name: cis-k8s-v1110-5.2.11
description: "Minimize the admission of Windows HostProcess Containers (Manual)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, windows-hostprocess]
cis_id: "5.2.11"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.11 Minimize the admission of Windows HostProcess Containers (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit Windows containers to be run with the `hostProcess` flag set to true.

## Rationale

A Windows container making use of the `hostProcess` flag can interact with the underlying Windows cluster node. As per the Kubernetes documentation, this provides "privileged access" to the Windows node.

Where Windows containers are used inside a Kubernetes cluster, there should be at least one admission control policy which does not permit `hostProcess` Windows containers.

If you need to run Windows containers which require `hostProcess`, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `securityContext.windowsOptions.hostProcess: true` will not be permitted unless they are run under a specific policy.

## Audit

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of `hostProcess` containers.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostProcess` containers.

## Default Value

By default, there are no restrictions on the creation of `hostProcess` containers.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/create-hostprocess-pod/
2. https://kubernetes.io/docs/concepts/security/pod-security-standards/
