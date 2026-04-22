---
name: cis-gke-v190-4.1.8
description: "Avoid bindings to system:anonymous (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, rbac, service-accounts, cluster-roles, secrets, wildcards]
cis_id: "4.1.8"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.8 Avoid bindings to system:anonymous (Automated)

## Profile Applicability

- Level 2

## Description

Avoid ClusterRoleBindings nor RoleBindings with the user `system:anonymous`.

## Rationale

Kubernetes assigns user `system:anonymous` to API server requests that have no authentication information provided. Binding a role to user `system:anonymous` gives any unauthenticated user the permissions granted by that role and is strongly discouraged.

## Impact

Unauthenticated users will have privileges and permissions associated with roles associated with the configured bindings.

Care should be taken before removing any `clusterrolebindings` or `rolebindings` from the environment to ensure they were not required for operation of the cluster. Use a more specific and authenticated user for cluster operations.

## Audit

Both CusterRoleBindings and RoleBindings should be audited. Use the following command to confirm there are no `ClusterRoleBindings` to `system:anonymous`:

```bash
$ kubectl get clusterrolebindings -o json   | jq -r '["Name"], ["-----"], (.items[] | select((.subjects | length) > 0) | select(any(.subjects[]; .name == "system:anonymous")) | [.metadata.namespace, .metadata.name]) | @tsv'
```

There should be no `ClusterRoleBindings` listed. If any bindings exist, review their permissions with the following command and reassess their privilege.

```bash
$ kubectl get clusterrolebinding [CLUSTER_ROLE_BINDING_NAME] -o json \
    | jq ' .roleRef.name +" " + .roleRef.kind' \
    | sed -e 's/"//g' \
    | xargs -l bash -c 'kubectl get $1 $0 -o yaml'
```

Confirm that there are no `RoleBindings` including the `system:anonymous` user:

```bash
$ kubectl get rolebindings -A -o json \
  | jq -r '["Namespace", "Name"], ["---------", "-----"], (.items[] | select((.subjects | length) > 0) | select(any(.subjects[]; .name == "system:anonymous")) | [.metadata.namespace, .metadata.name]) | @tsv'
```

There should be no `RoleBindings` listed.
If any bindings exist, review their permissions with the following command and reassess their privilege.

```bash
$ kubectl get rolebinding [ROLE_BINDING_NAME] --namespace [ROLE_BINDING_NAMESPACE] -o json \
    | jq ' .roleRef.name +" " + .roleRef.kind' \
    | sed -e 's/"//g' \
    | xargs -l bash -c 'kubectl get $1 $0 -o yaml --namespace [ROLE_BINDING_NAMESPACE]'
```

## Remediation

Identify all `clusterrolebindings` and `rolebindings` to the user system:anonymous. Check if they are used and review the permissions associated with the binding using the commands in the Audit section above or refer to GKE documentation.
Strongly consider replacing unsafe bindings with an authenticated, user-defined group.
Where possible, bind to non-default, user-defined groups with least-privilege roles.
If there are any unsafe bindings to the user `system:anonymous`, proceed to delete them after consideration for cluster operations with only necessary, safer bindings.

```bash
kubectl delete clusterrolebinding [CLUSTER_ROLE_BINDING_NAME]
kubectl delete rolebinding [ROLE_BINDING_NAME] --namespace [ROLE_BINDING_NAMESPACE]
```

## Default Value

No `clusterrolebindings` nor `rolebindings` with user `system:anonymous`.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/rbac/#discovery-roles

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.5 Establish and Maintain an Inventory of Service Accounts | | * | * |
| v7 | 16.8 Disable Any Unassociated Accounts | * | * | * |
