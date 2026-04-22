---
name: cis-k8s-v200-3.2.2
description: "Ensure that the audit policy covers key security concerns (Manual)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane-config, logging]
cis_id: "3.2.2"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 3.2.2

## Profile Applicability

- **Level:** 2 - Master Node

## Description

Ensure that the audit policy created for the cluster covers key security concerns.

## Rationale

Security audit logs should cover access and modification of key resources in the cluster, to enable them to form an effective part of a security environment.

## Impact

Increasing audit logging will consume resources on the nodes or other log destination.

## Audit Procedure

Review the audit policy provided for the cluster and ensure that it covers at least the following areas:

- Access to Secrets managed by the cluster. Care should be taken to only log Metadata for requests to Secrets, ConfigMaps, and TokenReviews, in order to avoid the risk of logging sensitive data.
- Modification of `pod` and `deployment` objects.
- Use of `pods/exec`, `pods/portforward`, `pods/proxy` and `services/proxy`.
- Use of the `CertificateSigningRequest` API which allows for creation of new credentials.
- Use of the `Token` sub-resource of `ServiceAccount` objects which allows for creation of new credentials.

For most requests, minimally logging at the Metadata level is recommended (the most basic level of logging). Exceptions should be created in the audit logging policy to ensure that system operations (e.g. the Kubelet creating new credentials) are not logged, to reduce operational load and the risk of false positives.

## Remediation

Consider modification of the audit policy in use on the cluster to include these items, at a minimum.

## Default Value

By default Kubernetes clusters do not log audit information.

## References

1. https://github.com/k8scop/k8s-security-dashboard/blob/master/configs/kubernetes/adv-audit.yaml
2. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/#audit-policy
3. https://github.com/kubernetes/kubernetes/blob/master/cluster/gce/gci/configure-helper.sh#L735

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs<br/>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | ●    | ●    |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data<br/>Enforce detailed audit logging for access to sensitive data or changes to sensitive data (utilizing tools such as File Integrity Monitoring or Security Information and Event Monitoring).                       |      |      | ●    |

## Profile

**Level 2 - Master Node** (Manual)
