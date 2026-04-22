---
name: cis-oke-v170-5.2.1
description: "Prefer using dedicated Service Accounts (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, iam]
cis_id: "5.2.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.2.1

## Profile Applicability

- **Level:** 1

## Description

Kubernetes workloads should not use cluster node service accounts to authenticate to Oracle Cloud APIs. Each Kubernetes Workload that needs to authenticate to other Oracle services using Cloud IAM should be provisioned a dedicated Service account.

## Rationale

Manual approaches for authenticating Kubernetes workloads running on OKE against Oracle Cloud APIs are: storing service account keys as a Kubernetes secret (which introduces manual key rotation and potential for key compromise); or use of the underlying nodes' IAM Service account, which violates the principle of least privilege on a multitenanted node, when one pod needs to have access to a service, but every other pod on the node that uses the Service account does not.

## Impact

None.

## Audit Procedure

For each namespace in the cluster, review the rights assigned to the default service account and ensure that it has no roles or cluster roles bound to it apart from the defaults.

Additionally ensure that the automountServiceAccountToken: false setting is in place for each default service account.

## Remediation

When you create a pod, if you do not specify a service account, it is automatically assigned the default service account in the same namespace. If you get the raw json or yaml for a pod you have created (for example, `kubectl get pods/<podname> -o yaml`), you can see the spec.serviceAccountName field has been automatically set.

See [Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)

## Default Value

By default, the default service account is used.

## References

1. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.5 Establish and Maintain an Inventory of Service Accounts |      | \*   | \*   |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts     | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |

## Profile

**Level 1** (Automated)
