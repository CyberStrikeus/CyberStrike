---
name: cis-gcp-foundations-1.9
description: "Ensure That Cloud KMS Cryptokeys Are Not Anonymously or Publicly Accessible"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.9"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.9 Ensure That Cloud KMS Cryptokeys Are Not Anonymously or Publicly Accessible (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended that the IAM policy on Cloud KMS `cryptokeys` should restrict anonymous and/or public access.

## Rationale

Granting permissions to `allUsers` or `allAuthenticatedUsers` allows anyone to access the dataset. Such access might not be desirable if sensitive data is stored at the location. In this case, ensure that anonymous and/or public access to a Cloud KMS `cryptokey` is not allowed.

## Impact

Removing the binding for `allUsers` and `allAuthenticatedUsers` members denies accessing `cryptokeys` to anonymous or public users.

## Audit Procedure

**From Google Cloud CLI**

1. List all Cloud KMS `Cryptokeys`.

```bash
gcloud kms keys list --keyring=[key_ring_name] --location=global --format=json | jq '.[].name'
```

2. Ensure the below command's output does not contain `allUsers` or `allAuthenticatedUsers`.

```bash
gcloud kms keys get-iam-policy [key_name] --keyring=[key_ring_name] --location=global --format=json | jq '.bindings[].members[]'
```

## Expected Result

The output should not contain `allUsers` or `allAuthenticatedUsers`.

## Remediation

**From Google Cloud CLI**

1. List all Cloud KMS `Cryptokeys`.

```bash
gcloud kms keys list --keyring=[key_ring_name] --location=global --format=json | jq '.[].name'
```

2. Remove IAM policy binding for a KMS key to remove access to `allUsers` and `allAuthenticatedUsers` using the below command.

```bash
gcloud kms keys remove-iam-policy-binding [key_name] --keyring=[key_ring_name] --location=global --member='allAuthenticatedUsers' --role='[role]'

gcloud kms keys remove-iam-policy-binding [key_name] --keyring=[key_ring_name] --location=global --member='allUsers' --role='[role]'
```

## Default Value

By default Cloud KMS does not allow access to `allUsers` or `allAuthenticatedUsers`.

## Additional Information

`[key_ring_name]` : Is the resource ID of the key ring, which is the fully-qualified Key ring name. This value is case-sensitive and in the form: `projects/PROJECT_ID/locations/LOCATION/keyRings/KEY_RING`

You can retrieve the key ring resource ID using the Cloud Console:

1. Open the `Cryptographic Keys` page in the Cloud Console.
2. For the key ring whose resource ID you are retrieving, click the `More icon (3 vertical dots)`.
3. Click `Copy Resource ID`. The resource ID for the key ring is copied to your clipboard.

`[key_name]` : Is the resource ID of the key, which is the fully-qualified CryptoKey name. This value is case-sensitive and in the form: `projects/PROJECT_ID/locations/LOCATION/keyRings/KEY_RING/cryptoKeys/KEY`

You can retrieve the key resource ID using the Cloud Console:

1. Open the `Cryptographic Keys` page in the Cloud Console.
2. Click the name of the key ring that contains the key.
3. For the key whose resource ID you are retrieving, click the `More icon (3 vertical dots)`.

## References

1. https://cloud.google.com/sdk/gcloud/reference/kms/keys/remove-iam-policy-binding
2. https://cloud.google.com/sdk/gcloud/reference/kms/keys/set-iam-policy
3. https://cloud.google.com/sdk/gcloud/reference/kms/keys/get-iam-policy
4. https://cloud.google.com/kms/docs/object-hierarchy#key_resource_id

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x    | x    | x    |
