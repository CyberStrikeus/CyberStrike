---
name: cis-k8s-v1111-5.2.2
description: "Minimize the admission of privileged containers (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, pod-security-standards, privileged]
cis_id: "5.2.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.2 Minimize the admission of privileged containers (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers to be run with the `securityContext.privileged` flag set to `true`.

## Rationale

Privileged containers have access to all Linux Kernel capabilities and devices. A container running with full privileges can do almost everything that the host can do. This flag exists to allow special use-cases, like manipulating the network stack and accessing devices.

There should be at least one admission control policy defined which does not permit privileged containers.

If you need to run privileged containers, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.containers[].securityContext.privileged: true`, `spec.initContainers[].securityContext.privileged: true` and `spec.ephemeralContainers[].securityContext.privileged: true` will not be permitted.

## Audit

Run the following command:

```bash
kubectl get pods -A -o=jsonpath=$'{range .items[*]}{@.metadata.name}: {@..securityContext}\n{end}'
```

It will produce an inventory of all the privileged use on the cluster, if any. Further grepping can be done to automate each specific violation detection.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of privileged containers.

## Default Value

By default, there are no restrictions on the creation of privileged containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X | X | X |
| v7 | 4 Controlled Use of Administrative Privileges | | | |
| v6 | 5.1 Minimize And Sparingly Use Administrative Privileges | | | |
