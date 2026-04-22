---
name: cis-k8s-v1120-5.2.11
description: "Minimize the admission of HostPath volumes (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security]
cis_id: "5.2.11"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.11 Minimize the admission of HostPath volumes (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally admit containers which make use of `hostPath` volumes.

## Rationale

A container which mounts a `hostPath` volume as part of its specification will have access to the filesystem of the underlying cluster node. The use of `hostPath` volumes may allow containers access to privileged areas of the node filesystem.

There should be at least one admission control policy defined which does not permit containers to mount `hostPath` volumes.

If you need to run containers which require `hostPath` volumes, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined which make use of `hostPath` volumes will not be permitted unless they are run under a specific policy.

## Audit Procedure

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of containers with `hostPath` volumes.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of containers which use `hostPath` volumes.

## Default Value

By default, there are no restrictions on the creation of `hostPath` volumes.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.12 Segment Data Processing and Storage Based on Sensitivity | | X | X |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers | | X | X |
