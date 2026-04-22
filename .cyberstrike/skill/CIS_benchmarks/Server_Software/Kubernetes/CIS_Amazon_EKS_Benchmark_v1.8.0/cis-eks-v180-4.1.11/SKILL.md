---
name: cis-eks-v180-4.1.11
description: "Minimize access to webhook configuration objects (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, webhooks, admission-control]
cis_id: "4.1.11"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.11 Minimize access to webhook configuration objects (Manual)

## Profile Applicability

- Level 1

## Description

Users with rights to create/modify/delete `validatingwebhookconfigurations` or `mutatingwebhookconfigurations` can control webhooks that can read any object admitted to the cluster, and in the case of mutating webhooks, also mutate admitted objects. This could allow for privilege escalation or disruption of the operation of the cluster.

## Rationale

The ability to manage webhook configuration should be limited.

## Audit Procedure

Review the users who have access to `validatingwebhookconfigurations` or `mutatingwebhookconfigurations` objects in the Kubernetes API.

```bash
kubectl get clusterroles -o json | jq -r '.items[] | select(.rules[]? | select(.resources[]? == "validatingwebhookconfigurations" or .resources[]? == "mutatingwebhookconfigurations")) | .metadata.name'
```

## Remediation

Where possible, remove access to the `validatingwebhookconfigurations` or `mutatingwebhookconfigurations` objects.

## Default Value

By default, the cluster-admin ClusterRole has access to webhook configuration objects.

## References

1. https://kubernetes.io/docs/concepts/security/rbac-good-practices/#control-admission-webhooks

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | ● |

## Profile Applicability

- Level 1
