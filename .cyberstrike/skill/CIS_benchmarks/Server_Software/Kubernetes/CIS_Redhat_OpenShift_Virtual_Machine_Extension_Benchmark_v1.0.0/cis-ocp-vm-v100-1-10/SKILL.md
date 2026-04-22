---
name: cis-ocp-vm-v100-1-10
description: "Restrict namespace administrator access to migration tools (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, platform-configuration, rbac, migration, namespace-admin]
cis_id: "1.10"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.10 — Restrict namespace administrator access to migration tools

## Profile Applicability
- Level 1

## Description
Namespace administrators have the capability to perform live migrations, which can potentially impact other users of the system. Live migration is a process where virtual machines can be moved from one physical host to another without any downtime, making it a valuable tool for managing clusters and ensuring high availability. However, since live migration involves moving data between hosts, it can have an impact on other users who may have applications running on the same hosts. As such, it is important to exercise caution when granting access to namespace administrators and ensure that appropriate safeguards are in place to minimize any potential disruptions.

## Rationale
Limiting the number of virtual machine migrations occurring simultaneously can help to ensure that the system remains stable and performs optimally during periods of high migration activity. If too many migrations are occurring at once, it can lead to increased resource usage, reduced processing power, and potential network congestion, all of which can impact system performance and availability.

The KubeVirt community is working towards removing migration functionality from namespace administrators in order to make it safer and more manageable. Live migration, on the other hand, will be reserved for cluster administrators. This separation of duties helps ensure that live migrations can be performed safely and without impacting other users of the system.

Please refer to the upstream proposal for more information.

## Impact
Using `VirtualMachineInterfaceMigrations` can introduce additional overhead to the system, particularly if a large number of migrations are occurring simultaneously. This can lead to increased resource usage and potential performance degradation, as the migration process requires significant processing power and network bandwidth. Additionally, if a migration fails or encounters errors during the migration process, it can cause downtime for the associated VM and potentially impact system availability.

## Audit Procedure
Use the following command to find users, service accounts and groups who are allowed to create `VirtualMachineInterfaceMigration` and `MigrationPolicy` resources:

```bash
$ oc adm policy who-can create vmim
$ oc adm policy who-can create migrationpolicy
```

Ensure users are authorized to perform those actions.

## Remediation
Remove `create` access to virtualmachineinstancemigration and migrationpolicy objects in the cluster. Example: Remove `create` access given by the `clusterRoleBinding` for the l `migrationpolicy` for the `test` user.

```bash
# Get all the users and service accounts who can create migrationpolicies
$ oc adm policy who-can create migrationpolicy
Users: system:admin
..
Test
# Verify that the test user can create the migrationpolicy
$ oc auth can-i create migrationpolicies --as test
Warning: resource 'migrationpolicies' is not namespace scoped in group 'migrations.kubevirt.io'
yes

# Find out which rolebinding or clusterrolbinding associated to the test user
$ oc get rolebindings,clusterrolebindings --all-namespaces -o custom-columns='KIND:kind,NAMESPACE:metadata.namespace,NAME:metadata.name,SERVICE_ACCOUNTS:subjects[?(@.kind=="User")].name' |grep test
ClusterRoleBinding <none> migration-creator test

# Inspect the cluster role binding
$ oc get clusterrolebindings migration-creator -oyaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  annotations:
  kubectl.kubernetes.io/last-applied-configuration: |
{"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRoleBinding","metadata":{"annotations":{},"name":"migration-creator"},"roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"ClusterRole","name":"migration-creator"},"subjects":[{"apiGroup":"rbac.authorization.k8s.io","kind":"User","name":"test"},{"kind":"ServiceAccount","name":"test","namespace":"default"}]}
  creationTimestamp: "2025-03-06T14:05:04Z"
  name: migration-creator
  resourceVersion: "1093678"
  uid: 96be5dc2-2b30-4734-b5ef-16d9342bbdbf
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: migration-creator
subjects:
- apiGroup: rbac.authorization.k8s.io
  kind: User
  name: test
- kind: ServiceAccount
  name: test
  namespace: default

# Remove the cluster role binding
$ oc delete clusterrolebindings migration-creator
clusterrolebinding.rbac.authorization.k8s.io "migration-creator" deleted

# Re-verify that the test user cannot create the migrationpolicy
$ oc auth can-i create migrationpolicies --as test
Warning: resource 'migrationpolicies' is not namespace scoped in group 'migrations.kubevirt.io'

no
```

## Default Value
By default, cluster administrators and namespace administrators can trigger virtual machine migrations.

## References
- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.10
- Upstream proposal: https://github.com/kubevirt/community/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control | N | N | Y |
| v7 | 5.1 Establish Secure Configurations | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1078 Valid Accounts |
| Defense Evasion | T1548 Abuse Elevation Control Mechanism |

## Profile
- Level 1 - OpenShift Virtualization
