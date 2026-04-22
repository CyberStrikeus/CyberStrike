---
name: cis-k8s-v200-3.1.2
description: "Service account token authentication should not be used for users (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-config, authentication, authorization]
cis_id: "3.1.2"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 3.1.2

## Profile Applicability
- **Level:** 1 - Master Node

## Description
Kubernetes provides service account tokens which are intended for use by workloads running in the Kubernetes cluster, for authentication to the API server.

These tokens are not designed for use by end-users and do not provide for features such as revocation or expiry, making them insecure. A newer version of the feature (Bound service account token volumes) does introduce expiry but still does not allow for specific revocation.

## Rationale
With any authentication mechanism the ability to revoke credentials if they are compromised or no longer required, is a key control. Service account token authentication does not allow for this due to the use of JWT tokens as an underlying technology.

## Impact
External mechanisms for authentication generally require additional software to be deployed.

## Audit Procedure

Review user access to the cluster and ensure that users are not making use of service account token authentication.

## Remediation

Alternative mechanisms provided by Kubernetes such as the use of OIDC should be implemented in place of service account tokens.

## Default Value
Service account token authentication is enabled by default.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.2 Establish an Access Revoking Process<br/>Establish and follow a process, preferably automated, for revoking access to enterprise assets, through disabling accounts immediately upon termination, rights revocation, or role change of a user. Disabling accounts, instead of deleting accounts, may be necessary to preserve audit trails. | ● | ● | ● |
| v7 | 16.7 Establish Process for Revoking Access<br/>Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails. | | ● | ● |

## Profile
**Level 1 - Master Node** (Manual)
