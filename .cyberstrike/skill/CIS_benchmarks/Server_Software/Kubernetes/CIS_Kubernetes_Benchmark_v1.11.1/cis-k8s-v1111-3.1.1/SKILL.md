---
name: cis-k8s-v1111-3.1.1
description: "Client certificate authentication should not be used for users (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-configuration, authentication, authorization, logging, audit-policy]
cis_id: "3.1.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1 Client certificate authentication should not be used for users (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Kubernetes provides the option to use client certificates for user authentication. However as there is no way to revoke these certificates when a user leaves an organization or loses their credential, they are not suitable for this purpose.

It is not possible to fully disable client certificate use within a cluster as it is used for component to component authentication.

## Rationale

With any authentication mechanism the ability to revoke credentials if they are compromised or no longer required, is a key control. Kubernetes client certificate authentication does not allow for this due to a lack of support for certificate revocation.

## Impact

External mechanisms for authentication generally require additional software to be deployed.

## Audit

Review user access to the cluster and ensure that users are not making use of Kubernetes client certificate authentication.

## Remediation

Alternative mechanisms provided by Kubernetes such as the use of OIDC should be implemented in place of client certificates.

## Default Value

Client certificate authentication is enabled by default.

## Additional Information

The lack of certificate revocation was flagged up as a high risk issue in the recent Kubernetes security audit. Without this feature, client certificate authentication is not suitable for end users.

## References

None

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process   | x    | x    | x    |
| v7               | 16.7 Establish Process for Revoking Access |      | x    | x    |
