---
name: cis-ocp-v180-1.2.10
description: "Ensure that the admission control plugin ServiceAccount is set (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.10"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.2.10

## Profile Applicability

- **Level:** 1

## Description

Automate service accounts management.

## Rationale

When you create a pod, if you do not specify a service account, it is automatically assigned the default service account in the same namespace. You should create your own service account and let the API server manage its security tokens.

## Impact

None.

## Audit Procedure

The `ServiceAccount` admission control plugin is enabled by default. Every service account has an associated user name that can be granted roles, just like a regular user. The user name for each service account is derived from its project and the name of the service account. Service accounts are required in each project to run builds, deployments, and other pods. The default service accounts that are automatically created for each project are isolated by the project namespace.

Use the following command to obtain a list of configured admission controllers:

```bash
oc -n openshift-kube-apiserver get configmap config -o json | jq -r '.data."config.yaml"' | jq '.apiServerArguments."enable-admission-plugins"'
```

Verify the list includes `ServiceAccount`.

## Remediation

None.

## Default Value

By default, OpenShift configures the `ServiceAccount` admission controller.

## References

1. https://docs.openshift.com/container-platform/latest/authentication/understanding-and-creating-service-accounts.html
2. https://docs.openshift.com/container-platform/latest/architecture/admission-plug-ins.html
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L34-L78
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
5. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#serviceaccount
6. https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078.001, T1552            | TA0001, TA0006 | M1043       |

## Profile

**Level 1** (Manual)
