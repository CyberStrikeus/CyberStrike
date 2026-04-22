---
name: cis-k8s-v1111-3.1.3
description: "Bootstrap token authentication should not be used for users (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-configuration, authentication, authorization, logging, audit-policy]
cis_id: "3.1.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.3 Bootstrap token authentication should not be used for users (Manual)

## Profile Applicability

- Level 1 - Master Node

## Description

Kubernetes provides bootstrap tokens which are intended for use by new nodes joining the cluster.

These tokens are not designed for use by end-users they are specifically designed for the purpose of bootstrapping new nodes and not for general authentication.

## Rationale

Bootstrap tokens are not intended for use as a general authentication mechanism and impose constraints on user and group naming that do not facilitate good RBAC design. They also cannot be used with MFA resulting in a weak authentication mechanism being available.

## Impact

External mechanisms for authentication generally require additional software to be deployed.

## Audit

Review user access to the cluster and ensure that users are not making use of bootstrap token authentication.

## Remediation

Alternative mechanisms provided by Kubernetes such as the use of OIDC should be implemented in place of bootstrap tokens.

## Default Value

Bootstrap token authentication is not enabled by default and requires an API server parameter to be set.

## References

None

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process   | x    | x    | x    |
| v7               | 16.7 Establish Process for Revoking Access |      | x    | x    |
