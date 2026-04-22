---
name: cis-k8s-v1120-5.2.12
description: "Minimize the admission of containers which use HostPorts (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security]
cis_id: "5.2.12"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.12 Minimize the admission of containers which use HostPorts (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers which require the use of HostPorts.

## Rationale

Host ports connect containers directly to the host's network. This can bypass controls such as network policy.

There should be at least one admission control policy defined which does not permit containers which require the use of HostPorts.

If you need to run containers which require HostPorts, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `hostPort` settings in either the container, initContainer or ephemeralContainer sections will not be permitted unless they are run under a specific policy.

## Audit Procedure

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of containers which have `hostPort` sections.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of containers which use `hostPort` sections.

## Default Value

By default, there are no restrictions on the use of HostPorts.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.5 Allowlist Authorized Software | | X | X |
| v8 | 2.6 Allowlist Authorized Libraries | | X | X |
| v8 | 2.7 Allowlist Authorized Scripts | | | X |
| v7 | 12.4 Deny Communication over Unauthorized Ports | X | X | X |
