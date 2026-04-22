---
name: cis-oke-v180-4.1.4
description: "Minimize access to create pods (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, rbac, service-accounts]
cis_id: "4.1.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.4 Minimize access to create pods (Manual)

## Profile Applicability

- Level 1

## Description

The ability to create pods in a namespace can provide a number of opportunities for privilege escalation, such as assigning privileged service accounts to these pods or mounting hostPaths with access to sensitive data (unless Pod Security Policies are implemented to restrict this access).

As such, access to create new pods should be restricted to the smallest possible group of users.

## Rationale

The ability to create pods in a cluster opens up possibilities for privilege escalation and should be restricted, where possible.

## Impact

Care should be taken not to remove access to pods to system components which require this for their operation.

## Audit

OKE is a standard Kubernetes cluster under the hood, so we can use kubectl auth can-i together with rolebinding lookups to get this info.

Run the following command to list all the users and service accounts that have access to create pod objects in the Kubernetes API:

```bash
echo "=== Users ==="
for user in $(kubectl get clusterrolebinding -o jsonpath='{range .items[*].subjects[?(@.kind=="User")]}{.name}{"\n"}{end}'); do
  if kubectl auth can-i create pods --as="$user" >/dev/null 2>&1; then
    echo "$user"
  fi
done

echo -e "\n=== Service Accounts ==="
for sa in $(kubectl get clusterrolebinding,rolebinding -A -o jsonpath='{range .items[*].subjects[?(@.kind=="ServiceAccount")]}{.namespace}:{.name}{"\n"}{end}'); do
  ns=$(echo "$sa" | cut -d: -f1)
  name=$(echo "$sa" | cut -d: -f2)
  if kubectl auth can-i create pods --as=system:serviceaccount:$ns:$name >/dev/null 2>&1; then
    echo "$sa"
  fi
done
```

- kubectl get clusterrolebinding and rolebinding return which users or service accounts are bound to roles.
- kubectl auth can-i create pods --as= checks effective permissions.
- The script loops over those bindings and prints only those who truly can create pods.

## Remediation

Where possible, remove `create` access to `pod` objects in the cluster.

## Default Value

By default, the following list of principals have `create` privileges on `pod` objects:

| CLUSTERROLEBINDING | SUBJECT | TYPE |
|---|---|---|
| cluster-admin | system:masters | Group |
| system:controller:daemon-set-controller | daemon-set-controller ServiceAccount kube-system | |
| system:controller:job-controller | job-controller ServiceAccount kube-system | |
| system:controller:persistent-volume-binder | persistent-volume-binder ServiceAccount kube-system | |
| system:controller:replicaset-controller | replicaset-controller ServiceAccount kube-system | |
| system:controller:replication-controller | replication-controller ServiceAccount kube-system | |
| system:controller:statefulset-controller | statefulset-controller ServiceAccount kube-system | |

## References

N/A

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |
