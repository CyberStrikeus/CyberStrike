---
name: cis-oke-v180-4.1.3
description: "Minimize wildcard use in Roles and ClusterRoles (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.3 Minimize wildcard use in Roles and ClusterRoles (Manual)

## Profile Applicability

- Level 1

## Description

Kubernetes Roles and ClusterRoles provide access to resources based on sets of objects and actions that can be taken on those objects. It is possible to set either of these to be the wildcard "\*" which matches all items.

Use of wildcards is not optimal from a security perspective as it may allow for inadvertent access to be granted when new resources are added to the Kubernetes API either as CRDs or in later versions of the product.

## Rationale

The principle of least privilege recommends that users are provided only the access required for their role and nothing more. The use of wildcard rights grants is likely to provide excessive rights to the Kubernetes API.

## Audit

Retrieve the roles defined across each namespaces in the cluster and review for wildcards.

Here's a null-safe, column-formatted command that shows only Roles and ClusterRoles that use a wildcard (\*) anywhere in verbs, resources, or apiGroups -- and tells you which field(s) use the wildcard:

```bash
kubectl get clusterrole,role -A -o json | jq -r '
  def has_star(a): (a // []) | any(. == "*");

  .items[]
  | . as $r
  | ( any($r.rules[]?; has_star(.verbs)) )      as $wv
  | ( any($r.rules[]?; has_star(.resources)) )   as $wr
  | ( any($r.rules[]?; has_star(.apiGroups)) )    as $wg
  | select($wv or $wr or $wg)
  | [
      $r.kind,
      $r.metadata.name,
      ($r.metadata.namespace // "cluster-wide"),
      ([ if $wv then "verbs" else empty end,
         if $wr then "resources" else empty end,
         if $wg then "apiGroups" else empty end ] | join(","))
    ]
  | @tsv
' | awk -F'\t' 'BEGIN {
  OFS="\t";
  printf "%-15s %-40s %-20s %-20s\n", "KIND", "NAME", "NAMESPACE", "WILDCARD_IN"
  print  "--------------- ---------------------------------------- -------------------- --------------------"
} {
  printf "%-15s %-40s %-20s %-20s\n", $1, $2, $3, $4
}'
```

## Remediation

Where possible replace any use of wildcards in clusterroles and roles with specific objects or actions.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078, T1078.002            | TA0001, TA0004 | M1026       |
