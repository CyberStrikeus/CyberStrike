---
name: cis-k8s-v1111-5.2.6
description: "Minimize the admission of containers with allowPrivilegeEscalation (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, pod-security, pod-security-standards, privilege-escalation]
cis_id: "5.2.6"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.6 Minimize the admission of containers with allowPrivilegeEscalation (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Do not generally permit containers to be run with the `allowPrivilegeEscalation` flag set to true. Allowing this right can lead to a process running a container getting more rights than it started with.

It's important to note that these rights are still constrained by the overall container sandbox, and this setting does not relate to the use of privileged containers.

## Rationale

A container running with the `allowPrivilegeEscalation` flag set to `true` may have processes that can gain more privileges than their parent.

There should be at least one admission control policy defined which does not permit containers to allow privilege escalation. The option exists (and is defaulted to true) to permit setuid binaries to run.

If you have need to run containers which use setuid binaries or require privilege escalation, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `securityContext: allowPrivilegeEscalation: true` will not be permitted unless they are run under a specific policy.

## Audit

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of containers which allow privilege escalation. To fetch a list of pods which `allowPrivilegeEscalation` run this command:

```bash
kubectl get pods -A -o=jsonpath=$'{range .items[*]}{@.metadata.name}: {@..securityContext}\n{end}'
```

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of containers with `securityContext: allowPrivilegeEscalation: true`.

## Default Value

By default, there are no restrictions on contained process ability to escalate privileges, within the context of the container.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-standards/

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X    | X    | X    |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
