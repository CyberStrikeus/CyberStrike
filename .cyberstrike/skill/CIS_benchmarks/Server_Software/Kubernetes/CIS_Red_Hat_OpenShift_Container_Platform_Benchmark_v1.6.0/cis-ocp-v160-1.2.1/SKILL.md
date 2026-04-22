---
name: cis-ocp-v160-1.2.1
description: "Ensure that anonymous requests are authorized (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, anonymous-auth]
cis_id: "1.2.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.1

## Profile Applicability
- **Level:** 1

## Description
When anonymous requests to the API server are allowed, they must be authorized.

## Rationale
When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the API server. You should rely on authentication to authorize anonymous requests.

If you are using RBAC authorization, it is generally considered reasonable to allow anonymous access to the API Server for health checks and discovery purposes, and hence this recommendation is not scored. However, you should consider whether anonymous discovery is an acceptable risk for your purposes.

## Impact
Anonymous requests are assigned to the `system:unauthenticated` group which allows the system to determine which actions are allowed.

## Audit Procedure
OpenShift allows anonymous requests (then authorizes them). OpenShift allows anonymous requests to the API server to support information discovery and webhook integrations. OpenShift provides its own fully integrated authentication and authorization mechanism. If no access token or certificate is presented, the authentication layer assigns the `system:anonymous` virtual user and the `system:unauthenticated` virtual group to the request. This allows the authorization layer to determine which requests, if any, an anonymous user is allowed to make.

```bash
oc get clusterrolebindings -o json | jq '.items[] | select(.subjects[]?.kind == "Group" and .subjects[]?.name == "system:unauthenticated") | .metadata.name' | uniq
```

Returns what unauthenticated users can do, which is the following:

```
"self-access-reviewers"
"system:oauth-token-deleters"
"system:openshift:public-info-viewer"
"system:public-info-viewer"
"system:scope-impersonation"
"system:webhooks"
```

## Remediation
None. The default configuration should not be modified.

## Default Value
By default, anonymous access is enabled and assigned to the `system:unauthenticated` group, which allows the system to determine which actions are allowed.

If the default behavior is changed, platform components will not work properly, in particular Elasticsearch and Prometheus. The `oauth-proxy` deployed as part of these components makes anonymous use of `/.well-known/oauth-authorization-server` endpoint, granted by `system:discovery` role.

## References
1. https://docs.openshift.com/container-platform/4.5/authentication/understanding-authentication.html
2. https://docs.openshift.com/container-platform/4.5/authentication/using-rbac.html
3. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#cluster-authentication-operator_red-hat-operators
4. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
5. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
6. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
7. https://kubernetes.io/docs/reference/access-authn-authz/authentication/#anonymous-requests

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1190, T1210 | TA0001, TA0008 | M1025 |

## Profile
**Level 1** (Manual)
