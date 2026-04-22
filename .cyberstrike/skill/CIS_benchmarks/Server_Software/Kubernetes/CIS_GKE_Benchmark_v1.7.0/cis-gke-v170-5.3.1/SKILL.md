---
name: cis-gke-v170-5.3.1
description: "Ensure Kubernetes Secrets are encrypted using keys managed in Cloud KMS (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, kms, encryption, secrets, etcd]
cis_id: "5.3.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1 Ensure Kubernetes Secrets are encrypted using keys managed in Cloud KMS (Automated)

## Profile Applicability

- Level 2

## Description

Encrypt Kubernetes secrets, stored in etcd, at the application-layer using a customer-managed key in Cloud KMS.

## Rationale

By default, GKE encrypts customer content stored at rest, including Secrets. GKE handles and manages this default encryption for you without any additional action on your part.

Application-layer Secrets Encryption provides an additional layer of security for sensitive data, such as user defined Secrets and Secrets required for the operation of the cluster, such as service account keys, which are all stored in etcd.

Using this functionality, you can use a key, that you manage in Cloud KMS, to encrypt data at the application layer. This protects against attackers in the event that they manage to gain access to etcd.

## Impact

To use the Cloud KMS CryptoKey to protect etcd in the cluster, the 'Kubernetes Engine Service Agent' Service account must hold the 'Cloud KMS CryptoKey Encrypter/Decrypter' role.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. From the list of clusters, click on each cluster to bring up the Details pane, and ensure Application-layer Secrets Encryption is set to 'Enabled'.

**Using Command Line:**

```bash
gcloud container clusters describe $CLUSTER_NAME --zone $COMPUTE_ZONE --format json | jq '.databaseEncryption'
```

If configured correctly, the output from the command returns a response containing the following detail:

```
keyName=projects/<key_project_id>/locations/<location>/keyRings/<ring_name>/cryptoKeys/<key_name>]
state=ENCRYPTED
```

```json
{
  "currentState": "CURRENT_STATE_ENCRYPTED",
  "keyName": "projects/<key_project_id>/locations/us-central1/keyRings/<ring_name>/cryptoKeys/<key_name>",
  "state": "ENCRYPTED"
}
```

## Remediation

To enable Application-layer Secrets Encryption, several configuration items are required. These include:

- A key ring
- A key
- A GKE service account with `Cloud KMS CryptoKey Encrypter/Decrypter` role

Once these are created, Application-layer Secrets Encryption can be enabled on an existing or new cluster.

**Using Google Cloud Console:**

To create a key:

1. Go to Cloud KMS by visiting https://console.cloud.google.com/security/kms.
2. Select `CREATE KEY RING`.
3. Enter a Key ring name and the region where the keys will be stored.
4. Click `CREATE`.
5. Enter a Key name and appropriate rotation period within the Create key pane.
6. Click `CREATE`.

To enable on a new cluster:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Click `CREATE CLUSTER`, and choose the required cluster mode.
3. Within the `Security` heading, under `CLUSTER`, check `Encrypt secrets at the application layer` checkbox.
4. Select the kms key as the customer-managed key and, if prompted, grant permissions to the GKE Service account.
5. Click `CREATE`.

To enable on an existing cluster:

1. Go to Kubernetes Engine by visiting: https://console.cloud.google.com/kubernetes/list.
2. Select the cluster to be updated.
3. Under the Details pane, within the Security heading, click on the pencil named Application-layer secrets encryption.
4. Enable `Encrypt secrets at the application layer` and choose a kms key.
5. Click `SAVE CHANGES`.

**Using Command Line:**

To create a key ring:

```bash
gcloud kms keyrings create <ring_name> --location <location> --project <key_project_id>
```

Create a key:

```bash
gcloud kms keys create <key_name> --location <location> --keyring <ring_name> --purpose encryption --project <key_project_id>
```

Grant the Kubernetes Engine Service Agent service account the `Cloud KMS CryptoKey Encrypter/Decrypter` role:

```bash
gcloud kms keys add-iam-policy-binding <key_name> --location <location> --keyring <ring_name> --member serviceAccount:<service_account_name> --role roles/cloudkms.cryptoKeyEncrypterDecrypter --project <key_project_id>
```

To create a new cluster with Application-layer Secrets Encryption:

```bash
gcloud container clusters create <cluster_name> --cluster-version=latest --zone <zone> --database-encryption-key projects/<key_project_id>/locations/<location>/keyRings/<ring_name>/cryptoKeys/<key_name> --project <cluster_project_id>
```

To enable on an existing cluster:

```bash
gcloud container clusters update <cluster_name> --zone <zone> --database-encryption-key projects/<key_project_id>/locations/<location>/keyRings/<ring_name>/cryptoKeys/<key_name> --project <cluster_project_id>
```

## Default Value

By default, Application-layer Secrets Encryption is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/encrypting-secrets

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |
