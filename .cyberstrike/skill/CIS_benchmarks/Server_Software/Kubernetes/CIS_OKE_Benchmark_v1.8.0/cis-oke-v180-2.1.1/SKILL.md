---
name: cis-oke-v180-2.1.1
description: "Client certificate authentication should not be used for users (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, control-plane-config, authentication, authorization]
cis_id: "2.1.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.8.0 - Control 2.1.1

## Profile Applicability

- **Level:** 1

## Description

Kubernetes provides the option to use client certificates for user authentication. However as there is no way to revoke these certificates when a user leaves an organization or loses their credential, they are not suitable for this purpose.

It is not possible to fully disable client certificate use within a cluster as it is used for component to component authentication.

## Rationale

With any authentication mechanism the ability to revoke credentials if they are compromised or no longer required, is a key control. Kubernetes client certificate authentication does not allow for this due to a lack of support for certificate revocation.

## Impact

External mechanisms for authentication generally require additional software to be deployed.

## Audit Procedure

Review user access to the cluster and ensure that users are not making use of Kubernetes client certificate authentication.

You can verify the availability of client certificates in your OKE cluster.

Run the following command to verify the availability of client certificates in your OKE cluster:

```bash
kubectl get secrets --namespace kube-system
```

This command lists all the secrets in the kube-system namespace, which includes the client certificates used for authentication.

Look for secrets with names starting with `oci-` or `oke-`. These secrets contain the client certificates. If the command returns secrets with such names, it indicates that client certificates are available in your OKE cluster.

## Remediation

Alternative mechanisms provided by Kubernetes such as the use of OIDC should be implemented in place of client certificates.

You can remediate the availability of client certificates in your OKE cluster.

## Default Value

See the OKE documentation for the default value.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/cis-benchmarks

## Additional Information

The lack of certificate revocation was flagged up as a high risk issue in the recent Kubernetes security audit. Without this feature, client certificate authentication is not suitable for end users.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                         | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1098                | TA0003, TA0006 |             |

## Profile

**Level 1** (Manual)
