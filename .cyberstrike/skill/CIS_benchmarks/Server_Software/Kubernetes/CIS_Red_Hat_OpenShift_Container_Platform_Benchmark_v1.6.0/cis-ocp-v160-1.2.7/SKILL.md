---
name: cis-ocp-v160-1.2.7
description: "Ensure that the --authorization-mode argument is not set to AlwaysAllow (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, authorization-mode]
cis_id: "1.2.7"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.7

## Profile Applicability
- **Level:** 1

## Description
Do not always authorize all requests.

## Rationale
The API Server, can be configured to allow all requests. This mode should not be used on any production cluster.

## Impact
Only authorized requests will be served.

## Audit Procedure
It is not possible to configure an OpenShift cluster to allow all requests. OpenShift is configured at bootstrap time to use RBAC to authorize requests. Role-based access control (RBAC) objects determine what actions a user is allowed to perform on what objects in an OpenShift cluster. Cluster administrators manage RBAC for the cluster. Project owners can manage RBAC for their individual OpenShift projects. The OpenShift API server configmap does not use the `authorization-mode` flag.

To verify, run the following commands:

```bash
$ oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments."authorization-mode"'
[
  "Scope",
  "SystemMasters",
  "RBAC",
  "Node"
]
```

## Remediation
None. RBAC is always on and the OpenShift API server does not use the values assigned to the flag authorization-mode.

## Default Value
OpenShift uses RBAC by default.

## References
1. https://docs.openshift.com/container-platform/4.5/authentication/using-rbac.html
2. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
3. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
4. https://kubernetes.io/docs/admin/kube-apiserver/
5. https://kubernetes.io/docs/reference/access-authn-authz/authorization/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1133 | TA0001 | M1026 |

## Profile
**Level 1** (Manual)
