---
name: cis-oke-v170-4.1.6
description: "Ensure that Service Account Tokens are only mounted where necessary (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.6"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 4.1.6

## Profile Applicability
- **Level:** 1

## Description
Service accounts tokens should not be mounted in pods except where the workload running in the pod explicitly needs to communicate with the API server.

## Rationale
Mounting service account tokens inside pods can provide an avenue for privilege escalation attacks where an attacker is able to compromise a single pod in the cluster.

Avoiding mounting these tokens removes this attack avenue.

## Impact
Pods mounted without service account tokens will not be able to communicate with the API server, except where the resource is available to unauthenticated principals.

## Audit Procedure
Review pod and service account objects in the cluster and ensure that the option below is set, unless the resource explicitly requires this access.

```
automountServiceAccountToken: false
```

Check for automountServiceAccountToken using:

```bash
export SERVICE_ACCOUNT=<service account name>
kubectl get serviceaccounts/$SERVICE_ACCOUNT -o yaml

export POD=<pod name>
kubectl get pods/$POD -o yaml
```

## Remediation
Modify the definition of pods and service accounts which do not need to mount service account tokens to disable it.

## Default Value
By default, all pods get a service account token mounted in them.

## References
1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | * | * | * |
| v7 | 5.1 Establish Secure Configurations | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1528, T1555 | TA0006 | M1026 |

## Profile
**Level 1** (Automated)
