---
name: cis-oke-v180-4.1.6
description: "Ensure that Service Account Tokens are only mounted where necessary (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.6"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.6 Ensure that Service Account Tokens are only mounted where necessary (Automated)

## Profile Applicability

- Level 1

## Description

Service accounts tokens should not be mounted in pods except where the workload running in the pod explicitly needs to communicate with the API server.

## Rationale

Mounting service account tokens inside pods can provide an avenue for privilege escalation attacks where an attacker is able to compromise a single pod in the cluster.

Avoiding mounting these tokens removes this attack avenue.

## Impact

Pods mounted without service account tokens will not be able to communicate with the API server, except where the resource is available to unauthenticated principals.

## Audit

Review pod and service account objects in the cluster and ensure that the option below is set, unless the resource explicitly requires this access.

```
automountServiceAccountToken: false
```

```bash
echo "=== ServiceAccounts with automountServiceAccountToken=false ==="
printf "%-25s %-40s\n" "NAMESPACE" "SERVICEACCOUNT"
echo "------------------------- ----------------------------------------"
kubectl get sa -A -o jsonpath='{range .items[?(@.automountServiceAccountToken==false)]}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}' \
| sort | awk -F'\t' '{printf "%-25s %-40s\n", $1, $2}'

echo ""
echo "=== Pods with automountServiceAccountToken=false ==="
printf "%-25s %-40s\n" "NAMESPACE" "POD"
echo "------------------------- ----------------------------------------"
kubectl get pods -A -o jsonpath='{range .items[?(@.spec.automountServiceAccountToken==false)]}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}' \
| sort | awk -F'\t' '{printf "%-25s %-40s\n", $1, $2}'
```

Note:
- If a section is empty, no objects explicitly set `automountServiceAccountToken: false` -- meaning they still auto-mount tokens by default, and may need remediation.

## Remediation

Modify the definition of pods and service accounts which do not need to mount service account tokens to disable it.

## Default Value

By default, all pods get a service account token mounted in them.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1528, T1555 | TA0006 | M1026 |
