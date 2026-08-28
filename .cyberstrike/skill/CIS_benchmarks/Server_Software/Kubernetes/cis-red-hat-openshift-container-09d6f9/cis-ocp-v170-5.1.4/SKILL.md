---
name: cis-ocp-v170-5.1.4
description: "Minimize access to create pods (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, rbac, service-accounts]
cis_id: "5.1.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.1.4

## Profile Applicability

- **Level:** 1

## Description

The ability to create pods in a namespace can provide a number of opportunities for privilege escalation, such as assigning privileged service accounts to these pods or mounting hostPaths with access to sensitive data (unless Pod Security Policies are implemented to restrict this access).

As such, access to create new pods should be restricted to the smallest possible group of users.

## Rationale

The ability to create pods in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact

Care should be taken not to remove access to pods to system components which require this for their operation.

## Audit Procedure

Review the users who have create access to pod objects in the Kubernetes API with the following command:

```bash
oc adm policy who-can create pod
```

## Remediation

Where possible, remove `create` access to `pod` objects in the cluster.

## Default Value

By default in a kubeadm cluster the following list of principals have `create` privileges on `pod` objects.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/rbac/#user-facing-roles

## CIS Controls

| Controls Version | Control                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------- | ---- | ---- | ---- |
| v8               | 2.7 Allowlist Authorized Scripts |      |      | \*   |
| v7               | 5.2 Maintain Secure Images       |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1078.002            | TA0001, TA0004 | M1026       |

## Profile

**Level 1** (Manual)
