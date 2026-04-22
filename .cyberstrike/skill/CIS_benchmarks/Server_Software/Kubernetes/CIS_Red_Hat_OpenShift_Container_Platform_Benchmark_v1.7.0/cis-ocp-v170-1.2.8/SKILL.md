---
name: cis-ocp-v170-1.2.8
description: "Verify that RBAC is enabled (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.8"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.8

## Profile Applicability
- **Level:** 1

## Description
Turn on Role Based Access Control.

## Rationale
Role Based Access Control (RBAC) allows fine-grained control over the operations that different entities can perform on different objects in the cluster. It is recommended to use the RBAC authorization mode.

## Impact
When RBAC is enabled you will need to ensure that appropriate RBAC settings (including Roles, RoleBindings, ClusterRoles, and ClusterRoleBindings) are configured to allow appropriate access.

## Audit Procedure
OpenShift is configured at bootstrap time to use Role-Based Access Control (RBAC) to authorize requests. RBAC objects determine what actions a user is allowed to perform on what objects in an OpenShift cluster. Cluster administrators manage RBAC for the cluster. Project owners can manage RBAC for their individual OpenShift projects.

Use the following command to verify the API server is configured to use RBAC for authorization:

```bash
$ oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments."authorization-mode"'
```

Verify the list returned contains `RBAC` as an authorization option.

## Remediation
None.

## Default Value
OpenShift uses RBAC by default. OpenShift includes default roles and role bindings. Custom roles and role bindings can be added for additional granularity.

Please refer to the OpenShift documentation for more information on RBAC.

## References
1. https://docs.openshift.com/container-platform/latest/authentication/index.html
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/bootkube/manifests/cluster-role-binding-kube-apiserver.yaml
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L17-L21
4. https://kubernetes.io/docs/reference/access-authn-authz/rbac/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078, T1548 | TA0001, TA0004 | M1018 |

## Profile
**Level 1** (Manual)
