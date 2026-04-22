---
name: cis-ocp-v190-5.1.6
description: "Ensure that Service Account Tokens are only mounted where necessary (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.6"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 5.1.6

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
Review pod and service account objects in the cluster and ensure automatically mounting the service account token is disabled (`automountServiceAccountToken: false`), unless the resource explicitly requires this access.

Find all pods that automatically mount service account tokens:

```bash
oc get pods -A -o json | jq '.items[] | select(.spec.automountServiceAccountToken) | .metadata.name'
```

Find all service accounts that automatically mount service tokens:

```bash
oc get serviceaccounts -A -o json | jq '.items[] | select(.automountServiceAccountToken) | .metadata.name'
```

## Remediation
Modify the definition of pods and service accounts which do not need to mount service account tokens to disable it.

## Default Value
By default, all pods get a service account token mounted in them.

## References
1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1528, T1555 | TA0006 | M1026 |

## Profile
**Level 1** (Manual)
