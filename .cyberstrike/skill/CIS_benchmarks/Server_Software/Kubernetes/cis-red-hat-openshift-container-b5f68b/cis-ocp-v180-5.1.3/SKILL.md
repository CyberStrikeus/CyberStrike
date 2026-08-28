---
name: cis-ocp-v180-5.1.3
description: "Minimize wildcard use in Roles and ClusterRoles (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 5.1.3

## Profile Applicability

- **Level:** 1

## Description

Kubernetes Roles and ClusterRoles provide access to resources based on sets of objects and actions that can be taken on those objects. It is possible to set either of these to be the wildcard "\*" which matches all items.

Use of wildcards is not optimal from a security perspective as it may allow for inadvertent access to be granted when new resources are added to the Kubernetes API either as CRDs or in later versions of the product.

## Rationale

The principle of least privilege recommends that users are provided only the access required for their role and nothing more. The use of wildcard rights grants is likely to provide excessive rights to the Kubernetes API.

## Audit Procedure

Run the command below to describe each cluster role and inspect it for wildcard usage:

```bash
oc describe clusterrole
```

Run the command below to describe each role and inspect it for wildcard usage:

```bash
oc describe role -A
```

## Remediation

Where possible replace any use of wildcards in clusterroles and roles with specific objects or actions.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | \*   |
| v7               | 4.4 Use Unique Passwords                              |      | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1078.002            | TA0001, TA0004 | M1026       |

## Profile

**Level 1** (Manual)
