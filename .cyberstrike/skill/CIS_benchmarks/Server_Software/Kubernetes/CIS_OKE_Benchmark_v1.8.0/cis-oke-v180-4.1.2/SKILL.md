---
name: cis-oke-v180-4.1.2
description: "Minimize access to secrets (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.2 Minimize access to secrets (Manual)

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

Below is a command to print which objects have get, list or watch granted for each matching role including roles that grant access via wildcards like resources: `["","secrets"]` or verbs: `["*"]`:

```bash
kubectl get clusterrole,role -A -o json | jq -r '
  def wanted: ["get","list","watch"];
  .items[] as $r
  | [ $r.rules[]?
        | select(
            ((.apiGroups? // [""]) | any(.=="" or .=="*"))
            and ((.resources? // []) | any(.=="secrets" or .=="secrets/*" or .=="*"))
            and ((.verbs? // []) | any(.=="*" or .=="get" or .=="list" or .=="watch"))
          )
        | if ((.verbs? // []) | any(.=="*"))
          then wanted[] else (.verbs[]? | select(IN("get","list","watch"))) end
    ] as $verbs
  | select($verbs | length > 0)
  | "\($r.kind): \($r.metadata.name) (namespace: \($r.metadata.namespace // "cluster-wide")) | verbs: \($verbs | unique | join(","))"
'
```

## Remediation

Where possible, remove `get`, `list` or `watch` access to `secret` objects in the cluster.

## Default Value

By default, the following list of principals have `get` privileges on `secret` objects:

| CLUSTERROLEBINDING                                   | SUBJECT                                                       | TYPE  |
| ---------------------------------------------------- | ------------------------------------------------------------- | ----- |
| cluster-admin                                        | system:masters                                                | Group |
| system:controller:clusterrole-aggregation-controller | clusterrole-aggregation-controller ServiceAccount kube-system |       |
| system:controller:expand-controller                  | expand-controller ServiceAccount kube-system                  |       |
| system:controller:generic-garbage-collector          | generic-garbage-collector ServiceAccount kube-system          |       |
| system:controller:namespace-controller               | namespace-controller ServiceAccount kube-system               |       |
| system:controller:persistent-volume-binder           | persistent-volume-binder ServiceAccount kube-system           |       |
| system:kube-controller-manager                       | system:kube-controller-manager User                           |       |

## References

1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1026       |
