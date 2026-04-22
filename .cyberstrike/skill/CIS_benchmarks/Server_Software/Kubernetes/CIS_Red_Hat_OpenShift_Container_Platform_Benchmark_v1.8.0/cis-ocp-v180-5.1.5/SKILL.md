---
name: cis-ocp-v180-5.1.5
description: "Ensure default service accounts not actively used (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.5"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 5.1.5

## Profile Applicability
- **Level:** 1

## Description
The `default` service account should not be used to ensure that rights granted to applications can be more easily audited and reviewed.

## Rationale
Kubernetes provides a `default` service account which is used by cluster workloads where no specific service account is assigned to the pod.

Where access to the Kubernetes API from a pod is required, a specific service account should be created for that pod, and rights granted to that service account.

The default service account should be configured such that it does not provide a service account token and does not have any explicit rights assignments.

## Impact
All workloads which require access to the Kubernetes API will require an explicit service account to be created.

## Audit Procedure
Every OpenShift project has its own service accounts. Every service account has an associated user name that can be granted roles, just like a regular user. The user name for each service account is derived from its project and the name of the service account. Service accounts are required in each project to run builds, deployments, and other pods. The default service accounts that are automatically created for each project are isolated by the project namespace.

## Remediation
None required.

## Default Value
By default, in OpenShift 4 every project has its own service accounts. Every service account has an associated user name that can be granted roles, just like a regular user. The user name for each service account is derived from its project and the name of the service account. Service accounts are required in each project to run builds, deployments, and other pods. The default service accounts that are automatically created for each project are isolated by the project namespace.

## References
1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.3 Disable Dormant Accounts | * | * | * |
| v7 | 16.9 Disable Dormant Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1552 | TA0006 | M1028 |

## Profile
**Level 1** (Manual)
