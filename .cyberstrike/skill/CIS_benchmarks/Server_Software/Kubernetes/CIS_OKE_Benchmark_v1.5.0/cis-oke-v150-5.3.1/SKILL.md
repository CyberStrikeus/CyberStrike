---
name: cis-oke-v150-5.3.1
description: "Ensure Kubernetes Secrets are encrypted (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, kms, encryption]
cis_id: "5.3.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1 Ensure Kubernetes Secrets are encrypted (Manual)

## Profile Applicability

- Level 1

## Description

Encrypt Kubernetes secrets, stored in etcd, at the application-layer using a customer-managed key.

## Rationale

The master nodes in a Kubernetes cluster store sensitive configuration data (such as authentication tokens, passwords, and SSH keys) as Kubernetes secret objects in etcd. Etcd is an open source distributed key-value store that Kubernetes uses for cluster coordination and state management. In the Kubernetes clusters created by Container Engine for Kubernetes, etcd writes and reads data to and from block storage volumes in the Oracle Cloud Infrastructure Block Volume service. Although the data in block storage volumes is encrypted, Kubernetes secrets at rest in etcd itself are not encrypted by default.

## Impact

None specified.

## Audit

Before you can create a cluster where Kubernetes secrets are encrypted in the etcd key-value store, you have to:

- know the name and OCID of a suitable master encryption key in Vault
- create a dynamic group that includes all clusters in the compartment in which you are going to create the new cluster
- create a policy authorizing the dynamic group to use the master encryption key

## Remediation

You can create a cluster in one tenancy that uses a master encryption key in a different tenancy. In this case, you have to write cross-tenancy policies to enable the cluster in its tenancy to access the master encryption key in the Vault service's tenancy. Note that if you want to create a cluster and specify a master encryption key that's in a different tenancy, you cannot use the Console to create the cluster.

For example, assume the cluster is in the ClusterTenancy, and the master encryption key is in the KeyTenancy. Users belonging to a group (OKEAdminGroup) in the ClusterTenancy have permissions to create clusters. A dynamic group (OKEAdminDynGroup) has been created in the cluster, with the rule ALL `{resource.type = 'cluster', resource.compartment.id = 'ocid1.compartment.oc1..<unique_ID>'}`, so all clusters created in the ClusterTenancy belong to the dynamic group.

In the root compartment of the KeyTenancy, the following policies:

- use the ClusterTenancy's OCID to map ClusterTenancy to the alias OKE_Tenancy
- use the OCIDs of OKEAdminGroup and OKEAdminDynGroup to map them to the aliases RemoteOKEAdminGroup and RemoteOKEClusterDynGroup respectively
- give RemoteOKEAdminGroup and RemoteOKEClusterDynGroup the ability to list, view, and perform cryptographic operations with a particular master key in the KeyTenancy

```
Define tenancy OKE_Tenancy as ocid1.tenancy.oc1..<unique_ID>
Define dynamic-group RemoteOKEClusterDynGroup as ocid1.dynamicgroup.oc1..<unique_ID>
Define group RemoteOKEAdminGroup as ocid1.group.oc1..<unique_ID>
Admit dynamic-group RemoteOKEClusterDynGroup of tenancy ClusterTenancy to use keys in tenancy where target.key.id = 'ocid1.key.oc1..<unique_ID>'
Admit group RemoteOKEAdminGroup of tenancy ClusterTenancy to use keys in tenancy where target.key.id = 'ocid1.key.oc1..<unique_ID>'
```

In the root compartment of the ClusterTenancy, the following policies:

- use the KeyTenancy's OCID to map KeyTenancy to the alias KMS_Tenancy
- give OKEAdminGroup and OKEAdminDynGroup the ability to use master keys in the KeyTenancy
- allow OKEAdminDynGroup to use a specific master key obtained from the KeyTenancy in the ClusterTenancy

```
Define tenancy KMS_Tenancy as ocid1.tenancy.oc1..<unique_ID>
Endorse group OKEAdminGroup to use keys in tenancy KMS_Tenancy
Endorse dynamic-group OKEAdminDynGroup to use keys in tenancy KMS_Tenancy
Allow dynamic-group OKEAdminDynGroup to use keys in tenancy where target.key.id = 'ocid1.key.oc1..<unique_ID>'
```

See Accessing Object Storage Resources Across Tenancies for more examples of writing cross-tenancy policies.

Having entered the policies, you can now run a command similar to the following to create a cluster in the ClusterTenancy that uses the master key obtained from the KeyTenancy:

```bash
oci ce cluster create --name oke-with-cross-kms --kubernetes-version v1.16.8 \
  --vcn-id ocid1.vcn.oc1.iad.<unique_ID> --service-lb-subnet-ids \
  '["ocid1.subnet.oc1.iad.<unique_ID>"]' --compartment-id \
  ocid1.compartment.oc1..<unique_ID> --kms-key-id ocid1.key.oc1.iad.<unique_ID>
```

## Default Value

Kubernetes secrets at rest in etcd are not encrypted by default.

## References

1. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengencryptingdata.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengencryptingdata.htm)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information.                                                                                                                                                                                                                             |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1022       |

## Profile

Level 1 - OKE
