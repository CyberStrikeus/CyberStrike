---
name: cis-gke-v180-5.9.1
description: "Enable Customer-Managed Encryption Keys (CMEK) for GKE Persistent Disks (PD) (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, storage, cmek, persistent-disks, boot-disks, encryption, cloud-kms]
cis_id: "5.9.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.9.1 Enable Customer-Managed Encryption Keys (CMEK) for GKE Persistent Disks (PD) (Manual)

## Profile Applicability

- Level 2

## Description

Use Customer-Managed Encryption Keys (CMEK) to encrypt dynamically-provisioned attached Google Compute Engine Persistent Disks (PDs) using keys managed within Cloud Key Management Service (Cloud KMS).

## Rationale

GCE persistent disks are encrypted at rest by default using envelope encryption with keys managed by Google. For additional protection, users can manage the Key Encryption Keys using Cloud KMS.

## Impact

Encryption of dynamically-provisioned attached disks requires the use of the self-provisioned Compute Engine Persistent Disk CSI Driver v0.5.1 or higher.

If CMEK is being configured with a regional cluster, the cluster must run GKE 1.14 or higher.

## Audit

Using Google Cloud Console:

1. Go to Compute Engine Disks by visiting: https://console.cloud.google.com/compute/disks.
2. Select each disk used by the cluster, and ensure the `Encryption Type` is listed as `Customer Managed`.

Using Command Line:
Identify the Persistent Volumes Used by the cluster:

```
kubectl get pv -o json | jq '.items[].metadata.name'
```

For each volume used create 2 variables for Persistent Volume Name and Compute Zone and then check that it is encrypted using a customer managed key by running the following command:

```
gcloud compute disks describe $PV_NAME --zone $COMPUTE_ZONE --format json | jq '.diskEncryptionKey.kmsKeyName'
```

This returns null (`{ }`) if a customer-managed encryption key is not used to encrypt the disk.

## Remediation

This cannot be remediated by updating an existing cluster. The node pool must either be recreated or a new cluster created.
Using Google Cloud Console:
This is not possible using Google Cloud Console.
Using Command Line:
Follow the instructions detailed at: https://cloud.google.com/kubernetes-engine/docs/how-to/using-cmek.

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
