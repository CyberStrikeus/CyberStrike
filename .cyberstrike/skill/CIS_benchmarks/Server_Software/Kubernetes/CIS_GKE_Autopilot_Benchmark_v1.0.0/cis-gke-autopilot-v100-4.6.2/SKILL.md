---
name: cis-gke-autopilot-v100-4.6.2
description: "Ensure that the seccomp profile is set to RuntimeDefault in the pod definitions (Automated)"
category: cis-gke-autopilot
version: "1.0.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, general-policies, security-context, seccomp, runtime-default]
cis_id: "4.6.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.0.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.6.2 Ensure that the seccomp profile is set to RuntimeDefault in the pod definitions (Automated)

## Profile Applicability

- Level 2

## Description

Enable `RuntimeDefault` seccomp profile in the pod definitions.

## Rationale

Seccomp (secure computing mode) is used to restrict the set of system calls applications can make, allowing cluster administrators greater control over the security of workloads running in the cluster. Kubernetes disables seccomp profiles by default for historical reasons. It should be enabled to ensure that the workloads have restricted actions available within the container.

## Impact

If the `RuntimeDefault` seccomp profile is too restrictive for you, you would have to create/manage your own `Localhost` seccomp profiles.

## Audit

Review the pod definitions output for all namespaces in the cluster with the command below.

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.metadata.annotations."seccomp.security.alpha.kubernetes.io/pod" == "runtime/default" or .spec.securityContext.seccompProfile.type == "RuntimeDefault") | {namespace: .metadata.namespace, name: .metadata.name, seccompProfile: .spec.securityContext.seccompProfile.type}'
```

## Remediation

Use security context to enable the `RuntimeDefault` seccomp profile in your pod definitions. An example is as below:

```json
{
  "namespace": "kube-system",
  "name": "metrics-server-v0.7.0-dbcc8ddf6-gz7d4",
  "seccompProfile": "RuntimeDefault"
}
```

## Default Value

By default, seccomp profile is set to `unconfined` which means that no seccomp profiles are enabled.

## References

1. https://kubernetes.io/docs/tutorials/security/seccomp/
2. https://cloud.google.com/kubernetes-engine/docs/concepts/seccomp-in-gke

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure | | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |
