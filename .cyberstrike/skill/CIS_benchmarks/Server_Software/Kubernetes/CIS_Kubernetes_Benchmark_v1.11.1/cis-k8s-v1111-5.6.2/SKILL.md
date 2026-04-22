---
name: cis-k8s-v1111-5.6.2
description: "Ensure that the seccomp profile is set to docker/default in your pod definitions (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, general-policies, seccomp, security-context]
cis_id: "5.6.2"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.2 Ensure that the seccomp profile is set to docker/default in your pod definitions (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Enable `docker/default` seccomp profile in your pod definitions.

## Rationale

Seccomp (secure computing mode) is used to restrict the set of system calls applications can make, allowing cluster administrators greater control over the security of workloads running in the cluster. Kubernetes disables seccomp profiles by default for historical reasons. You should enable it to ensure that the workloads have restricted actions available within the container.

## Impact

If the `docker/default` seccomp profile is too restrictive for you, you would have to create/manage your own seccomp profiles.

## Audit

Review the pod definitions in your cluster. It should create a line as below:

```yaml
  securityContext:
    seccompProfile:
      type: RuntimeDefault
```

## Remediation

Use security context to enable the `docker/default` seccomp profile in your pod definitions. An example is as below:

```yaml
  securityContext:
    seccompProfile:
      type: RuntimeDefault
```

## Default Value

By default, seccomp profile is set to `unconfined` which means that no seccomp profiles are enabled.

## References

1. https://kubernetes.io/docs/tutorials/clusters/seccomp/
2. https://docs.docker.com/engine/security/seccomp/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure | | X | X |
| v7 | 5.2 Maintain Secure Images | | X | X |
