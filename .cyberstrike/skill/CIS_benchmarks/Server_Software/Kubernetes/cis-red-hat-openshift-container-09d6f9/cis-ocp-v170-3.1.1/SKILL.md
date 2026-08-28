---
name: cis-ocp-v170-3.1.1
description: "Client certificate authentication should not be used for users (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane-config, authentication, authorization]
cis_id: "3.1.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 3.1.1

## Profile Applicability

- **Level:** 2

## Description

Kubernetes provides the option to use client certificates for user authentication. However as there is no way to revoke these certificates when a user leaves an organization or loses their credential, they are not suitable for this purpose.

It is not possible to fully disable client certificate use within a cluster as it is used for component to component authentication.

## Rationale

With any authentication mechanism the ability to revoke credentials if they are compromised or no longer required, is a key control. Kubernetes client certificate authentication does not allow for this due to a lack of support for certificate revocation.

## Impact

External mechanisms for authentication generally require additional software to be deployed.

## Audit Procedure

For users to interact with OpenShift Container Platform, they must first authenticate to the cluster. The authentication layer identifies the user with requests to the OpenShift Container Platform API. The authorization layer then uses information about the requesting user to determine if the request is allowed.

The OpenShift Container Platform includes a built-in OAuth server for token-based authentication. Developers and administrators obtain OAuth access tokens to authenticate themselves to the API. It is recommended for an administrator to configure OAuth to specify an identity provider after the cluster is installed. User access to the cluster is managed through the identity provider.

First, verify user authentication is enabled:

```bash
oc describe authentication
```

Next, verify an identity provider is configured:

```bash
oc get oauth -o json | jq '.items[].spec.identityProviders'
```

Verify at least one identity provider is configured, and verify that the `kubeadmin` user does not exist.

Next, verify a `cluster-admin` user exists:

```bash
oc get clusterrolebindings -o='custom-columns=NAME:.metadata.name,ROLE:.roleRef.name,SUBJECT:.subjects[*].kind' | grep cluster-admin | grep User
```

Verify at least one user has the `cluster-admin` role.

Finally, verify that the `kubeadmin` secret is removed:

```bash
oc get secrets kubeadmin -n kube-system
```

No result is expected.

## Remediation

Configure an identity provider for the OpenShift cluster following the OpenShift [documentation](https://docs.openshift.com/container-platform/latest/authentication/understanding-identity-provider.html). Once an identity provider has been defined, you can use RBAC to define and apply permissions.

After you define an identity provider and create a new `cluster-admin` user you can reduce the attack surface by removing the default `kubeadmin` user.

## Default Value

By default, only a `kubeadmin` user exists on your cluster. To specify an identity provider, you must create a Custom Resource (CR) that describes that identity provider and add it to the cluster.

## References

1. https://docs.openshift.com/container-platform/latest/authentication/understanding-identity-provider.html
2. https://docs.openshift.com/container-platform/latest/authentication/using-rbac.html#authorization-overview_using-rbac
3. https://docs.openshift.com/container-platform/latest/authentication/remove-kubeadmin.html

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components   |      | \*   | \*   |
| v7               | 16.2 Configure Centralized Point of Authentication                              |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations  |
| --------------------------- | -------------- | ------------ |
| T1078, T1098                | TA0003, TA0006 | M1027, M1032 |

## Profile

**Level 2** (Manual)
