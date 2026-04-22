---
name: cis-aks-v180-4.1.9
description: "Minimize access to the proxy sub-resource of nodes (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, rbac, service-accounts, node-proxy, kubelet-api, privilege-escalation]
cis_id: "4.1.9"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.9 Minimize access to the proxy sub-resource of nodes (Manual)

## Profile Applicability

- Level 1

## Description

Users with access to the `Proxy` sub-resource of `Node` objects automatically have permissions to use the kubelet API, which may allow for privilege escalation or bypass cluster security controls such as audit logs.

The kubelet provides an API which includes rights to execute commands in any container running on the node. Access to this API is covered by permissions to the main Kubernetes API via the `node` object. The proxy sub-resource specifically allows wide ranging access to the kubelet API.

Direct access to the kubelet API bypasses controls like audit logging (there is no audit log of kubelet API access) and admission control.

## Rationale

The ability to use the `proxy` sub-resource of `node` objects opens up possibilities for privilege escalation and should be restricted, where possible.

## Audit

Review the users who have access to the `proxy` sub-resource of `node` objects in the Kubernetes API.

## Remediation

Where possible, remove access to the `proxy` sub-resource of `node` objects.

## References

1. [https://kubernetes.io/docs/concepts/security/rbac-good-practices/#access-to-proxy-subresource-of-nodes](https://kubernetes.io/docs/concepts/security/rbac-good-practices/#access-to-proxy-subresource-of-nodes)
2. [https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/#kubelet-authorization](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/#kubelet-authorization)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
