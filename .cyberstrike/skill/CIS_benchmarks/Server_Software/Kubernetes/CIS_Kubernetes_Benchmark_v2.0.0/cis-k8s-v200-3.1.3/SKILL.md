---
name: cis-k8s-v200-3.1.3
description: "Bootstrap token authentication should not be used for users (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-config, authentication, authorization]
cis_id: "3.1.3"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 3.1.3

## Profile Applicability

- **Level:** 1 - Master Node

## Description

Kubernetes provides bootstrap tokens which are intended for use by new nodes joining the cluster.

These tokens are not designed for use by end-users they are specifically designed for the purpose of bootstrapping new nodes and not for general authentication.

## Rationale

Bootstrap tokens are not intended for use as a general authentication mechanism and impose constraints on user and group naming that do not facilitate good RBAC design. They also cannot be used with MFA resulting in a weak authentication mechanism being available.

## Impact

External mechanisms for authentication generally require additional software to be deployed.

## Audit Procedure

Review user access to the cluster and ensure that users are not making use of bootstrap token authentication.

## Remediation

Alternative mechanisms provided by Kubernetes such as the use of OIDC should be implemented in place of bootstrap tokens.

## Default Value

Bootstrap token authentication is not enabled by default and requires an API server parameter to be set.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process<br/>Establish and follow a process, preferably automated, for revoking access to enterprise assets, through disabling accounts immediately upon termination, rights revocation, or role change of a user. Disabling accounts, instead of deleting accounts, may be necessary to preserve audit trails. | ●    | ●    | ●    |
| v7               | 16.7 Establish Process for Revoking Access<br/>Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails.                 |      | ●    | ●    |

## Profile

**Level 1 - Master Node** (Manual)
