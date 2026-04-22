---
name: cis-k8s-v1120-5.2.10
description: "Minimize the admission of Windows HostProcess Containers (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security]
cis_id: "5.2.10"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.10 Minimize the admission of Windows HostProcess Containers (Manual)

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

## Audit Procedure

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of `hostProcess` containers.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of `hostProcess` containers.

## Default Value

By default, there are no restrictions on the creation of `hostProcess` containers.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/create-hostprocess-pod/
2. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.11 Leverage Vetted Modules or Services for Application Security Components | | X | X |
| v7 | 4.7 Limit Access to Script Tools | | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
