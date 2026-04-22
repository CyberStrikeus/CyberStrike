---
name: cis-gke-v180-5.9.2
description: "Enable Customer-Managed Encryption Keys (CMEK) for Boot Disks (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, storage, cmek, persistent-disks, boot-disks, encryption, cloud-kms]
cis_id: "5.9.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.9.2 Enable Customer-Managed Encryption Keys (CMEK) for Boot Disks (Automated)

## Profile Applicability

- Level 2

## Description

Use Customer-Managed Encryption Keys (CMEK) to encrypt node boot disks using keys managed within Cloud Key Management Service (Cloud KMS).

## Rationale

GCE persistent disks are encrypted at rest by default using envelope encryption with keys managed by Google. For additional protection, users can manage the Key Encryption Keys using Cloud KMS.

## Impact

Encryption of dynamically-provisioned attached disks requires the use of the self-provisioned Compute Engine Persistent Disk CSI Driver v0.5.1 or higher.

If CMEK is being configured with a regional cluster, the cluster must run GKE 1.14 or higher.

## Audit

Using Google Cloud Console:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click on each cluster, and click on any Node pools.
3. On the Node pool Details page, under the `Security` heading, check that `Boot disk encryption type` is set to `Customer managed` with the desired key.

Using Command Line:
To check for Customer-Managed Encryption Keys (CMEK) first define 3 variables for Node Pool, Cluster Name and Zone and then run this command:

```
gcloud container node-pools describe $NODE_POOL --cluster $CLUSTER_NAME --zone $COMPUTE_ZONE
```

Verify that the output of the above command includes a `diskType` of either `pd-standard`, `pd-balanced` or `pd-ssd`, and the `bootDiskKmsKey` is specified as the desired key.

## Remediation

This cannot be remediated by updating an existing cluster. The node pool must either be recreated or a new cluster created.
Using Google Cloud Console:
To create a new node pool:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select Kubernetes clusters for which node boot disk CMEK is disabled.
3. Click `ADD NODE POOL`.
4. In the Nodes section, under machine configuration, ensure Boot disk type is `Standard persistent disk` or `SSD persistent disk`.
5. Select `Enable customer-managed encryption for Boot Disk` and select the Cloud KMS encryption key to be used.
6. Click `CREATE`.

To create a new cluster:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click `CREATE` and click `CONFIGURE for the required cluster mode.
3. Under `NODE POOLS, expand the default-pool list and click` Nodes.
4. In the Configure node settings pane, select `Standard persistent disk` or `SSD Persistent Disk` as the Boot disk type.
5. Select `Enable customer-managed encryption for Boot Disk` check box and choose the Cloud KMS encryption key to be used.
6. Configure the rest of the cluster settings as required.
7. Click `CREATE`.

Using Command Line:
Create a new node pool using customer-managed encryption keys for the node boot disk, of `<disk_type>` either `pd-standard` or `pd-ssd`:

```
gcloud container node-pools create <cluster_name> --disk-type <disk_type> --boot-disk-kms-key projects/<key_project_id>/locations/<location>/keyRings/<ring_name>/cryptoKeys/<key_name>
```

Create a cluster using customer-managed encryption keys for the node boot disk, of `<disk_type>` either `pd-standard` or `pd-ssd`:

```
gcloud container clusters create <cluster_name> --disk-type <disk_type> --boot-disk-kms-key projects/<key_project_id>/locations/<location>/keyRings/<ring_name>/cryptoKeys/<key_name>
```

## Default Value

Persistent disks are encrypted at rest by default, but are not encrypted using Customer-Managed Encryption Keys by default. By default, the Compute Engine Persistent Disk CSI Driver is not provisioned within the cluster.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/using-cmek
2. https://cloud.google.com/compute/docs/disks/customer-managed-encryption
3. https://cloud.google.com/security/encryption-at-rest/default-encryption/
4. https://cloud.google.com/kubernetes-engine/docs/concepts/persistent-volumes
5. https://cloud.google.com/sdk/gcloud/reference/container/node-pools/create

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |
