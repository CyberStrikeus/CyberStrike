---
name: cis-gke-autopilot-v100-4.1.10
description: "Avoid non-default bindings to system:authenticated (Automated)"
category: cis-gke-autopilot
version: "1.0.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, rbac, service-accounts, authenticated, cluster-role-bindings]
cis_id: "4.1.10"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.0.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.10 Avoid non-default bindings to system:authenticated (Automated)

## Profile Applicability

- Level 1

## Description

Avoid non-default `ClusterRoleBindings` and `RoleBindings` with the group `system:authenticated`, except the `ClusterRoleBindings` `system:basic-user`, `system:discovery`, and `system:public-info-viewer`.

Google's approach to authentication is to make authenticating to Google Cloud and GKE as simple and secure as possible without adding complex configuration steps. The group `system:authenticated` includes all users with a Google account, which includes all Gmail accounts. Consider your authorization controls with this extended group scope when granting permissions. Thus, group `system:authenticated` is not recommended for non-default use.

## Rationale

GKE assigns the group `system:authenticated` to API server requests made by any user who is signed in with a Google Account, including all Gmail accounts. In practice, this isn't meaningfully different from `system:unauthenticated` because anyone can create a Google Account.

Binding a role to the group `system:authenticated` gives any user with a Google Account, including all Gmail accounts, the permissions granted by that role and is strongly discouraged.

## Impact

Authenticated users in group `system:authenticated` should be treated similarly to users in `system:unauthenticated`, having privileges and permissions associated with roles associated with the configured bindings.

Care should be taken before removing any non-default `clusterrolebindings` or `rolebindings` from the environment to ensure they were not required for operation of the cluster. Leverage a more specific and authenticated user for cluster operations.

## Audit

Use the following command to confirm there are no non-default `ClusterRoleBindings` to `system:authenticated`:

```bash
$ kubectl get clusterrolebindings -o json   | jq -r '["Name"], ["-----"], (.items[] | select((.subjects | length) > 0) | select(any(.subjects[]; .name == "system:unauthenticated")) | [.metadata.namespace, .metadata.name]) | @tsv'
```

Only the following default `ClusterRoleBindings` should be displayed:

```
Name
-----
        system:basic-user
        system:discovery
        system:public-info-viewer
```

If any non-default bindings exist, review their permissions with the following command and reassess their privilege.

```bash
$ kubectl get clusterrolebinding CLUSTER_ROLE_BINDING_NAME -o json \
    | jq ' .roleRef.name +" " + .roleRef.kind' \
    | sed -e 's/"//g' \
    | xargs -l bash -c 'kubectl get $1 $0 -o yaml'
```

Confirm that there are no RoleBindings including the `system:authenticated` group:

```bash
$ kubectl get rolebindings -A -o json \
  | jq -r '["Namespace", "Name"], ["---------", "-----"], (.items[] | select((.subjects | length) > 0) | select(any(.subjects[]; .name == "system:unauthenticated")) | [.metadata.namespace, .metadata.name]) | @tsv'
```

There should be no `RoleBindings` listed. If any bindings exist, review their permissions with the following command and reassess their privilege.

```bash
$ kubectl get rolebinding [ROLE_BINDING_NAME] --namespace [ROLE_BINDING_NAMESPACE] -o json \
    | jq ' .roleRef.name +" " + .roleRef.kind' \
    | sed -e 's/"//g' \
    | xargs -l bash -c 'kubectl get $1 $0 -o yaml --namespace [ROLE_BINDING_NAMESPACE]'
```

## Remediation

Identify all non-default `clusterrolebindings` and `rolebindings` to the group `system:authenticated`. Check if they are used and review the permissions associated with the binding using the commands in the Audit section above or refer to GKE documentation.
Strongly consider replacing non-default, unsafe bindings with an authenticated, user-defined group. Where possible, bind to non-default, user-defined groups with least-privilege roles.
If there are any non-default, unsafe bindings to the group `system:authenticated`, proceed to delete them after consideration for cluster operations with only necessary, safer bindings.

```bash
kubectl delete clusterrolebinding [CLUSTER_ROLE_BINDING_NAME]
kubectl delete rolebinding [ROLE_BINDING_NAME] --namespace [ROLE_BINDING_NAMESPACE]
```

## Default Value

`ClusterRoleBindings` with group `system:authenticated`:

- `system:basic-user`
- `system:discovery`

No `RoleBindings` with the group `system:authenticated`.

## References

1. https://kubernetes.io/docs/reference/access-authn-authz/rbac/#discovery-roles

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | \*   | \*   | \*   |
| v7               | 4 Controlled Use of Administrative Privileges                             |      |      |      |
