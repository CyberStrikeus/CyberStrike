---
name: cis-ocp-v170-1.2.2
description: "Ensure that the --basic-auth-file argument is not set (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.2

## Profile Applicability
- **Level:** 1

## Description
Do not use basic authentication.

## Rationale
Basic authentication uses plaintext credentials for authentication. Currently, the basic authentication credentials last indefinitely, and the password cannot be changed without restarting the API server. The basic authentication is currently supported for convenience. Hence, basic authentication should not be used.

## Impact
OpenShift uses tokens and certificates for authentication.

## Audit Procedure
OpenShift provides its own fully integrated authentication and authorization mechanism. The `apiserver` is protected by either requiring an OAuth token issued by the platform's integrated OAuth server or signed certificates. The `basic-auth-file` method is not enabled in OpenShift.

Run the following command:

```bash
oc -n openshift-kube-apiserver get cm config -o yaml | grep --color "basic-auth"
oc -n openshift-apiserver get cm config -o yaml | grep --color "basic-auth"
oc get clusteroperator authentication
```

Verify that the `--basic-auth-file` argument does not exist.
Verify that the `authentication-operator` is running: Available is True.

## Remediation
None required. `--basic-auth-file` cannot be configured on OpenShift.

## Default Value
By default, `--basic-auth-file` argument is not set and OAuth authentication is configured.

## References
1. https://docs.openshift.com/container-platform/4.5/authentication/configuring-internal-oauth.html
2. https://docs.openshift.com/container-platform/4.5/authentication/understanding-authentication.html
3. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#cluster-authentication-operator_red-hat-operators
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
5. https://kubernetes.io/docs/reference/access-authn-authz/authentication/#static-password-file

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.6 Securely Manage Enterprise Assets and Software | * | * | * |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078 | TA0001, TA0006 | M1043 |

## Profile
**Level 1** (Manual)
