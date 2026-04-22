---
name: cis-gke-v170-4.1.2
description: "Minimize access to secrets (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, rbac, service-accounts, cluster-roles, secrets, wildcards]
cis_id: "4.1.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2 Minimize access to secrets (Automated)

## Profile Applicability

- Level 1

## Description

The Kubernetes API stores secrets, which may be service account tokens for the Kubernetes API or credentials used by workloads in the cluster. Access to these secrets should be restricted to the smallest possible group of users to reduce the risk of privilege escalation.

## Rationale

Inappropriate access to secrets stored within the Kubernetes cluster can allow for an attacker to gain additional access to the Kubernetes cluster or external resources whose credentials are stored as secrets.

## Impact

Care should be taken not to remove access to secrets to system components which require this for their operation.

## Audit

Review the users who have `get`, `list` or `watch` access to `secrets` objects in the Kubernetes API.

## Remediation

Where possible, remove `get`, `list` and `watch` access to `secret` objects in the cluster.

## Default Value

CLUSTERROLEBINDING                                                    SUBJECT
TYPE              SA-NAMESPACE
cluster-admin                                                         system:masters
Group
system:controller:clusterrole-aggregation-controller                  clusterrole-aggregation-controller    ServiceAccount    kube-system
system:controller:expand-controller                                   expand-controller                     ServiceAccount    kube-system
system:controller:generic-garbage-collector                           generic-garbage-collector              ServiceAccount    kube-system
system:controller:namespace-controller                                namespace-controller                  ServiceAccount    kube-system
system:controller:persistent-volume-binder                            persistent-volume-binder              ServiceAccount    kube-system
system:kube-controller-manager                                        system:kube-controller-manager        User

## References

None specified.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | * | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |
