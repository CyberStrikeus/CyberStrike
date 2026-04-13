---
name: cis-azure-storage-18.1
description: "Ensure that shared access signature (SAS) tokens expire within an hour"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-explorer, sas]
cis_id: "18.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 18.1 Ensure that shared access signature (SAS) tokens expire within an hour (Manual)

## Description

Shared access signature (SAS) tokens provide restricted access to Azure Storage resources (such as blobs, files, queues, or tables) for a defined time period with specific permissions. It enables users to interact with the resources without exposing account keys, offering precise control over the permitted actions (e.g., read, write) and the duration of access. To minimize security risks, SAS tokens should be configured with the shortest possible lifespan, ideally lasting no longer than an hour.

## Rationale

A short lifespan for SAS tokens is recommended to minimize the risk of unauthorized access. SAS tokens grant time-limited access to resources, and a longer duration increases the opportunity for misuse if the token is compromised. By setting a shorter lifespan, the potential for security breaches is reduced.

## Impact

SAS can pose security risks if they are not managed carefully.

## Audit Procedure

Currently, SAS token expiration times cannot be audited. Until Microsoft makes the token expiration time a setting rather than a token creation parameter, this recommendation will require manual verification.

## Expected Result

All SAS tokens should be configured with an expiry time of one hour or less from the time of creation.

## Remediation

### Remediate from Storage Explorer

If SAS have been created without a short lifespan and were created with a stored access policy (SAP), the SAS can be revoked by deleting the SAP or updating the SAP expiration time to a time in the past:

1. In Storage Explorer, expand `Storage Accounts`.
2. Expand a storage account.
3. Expand `Blob Containers`, `File Shares`, `Queues`, or `Tables`, and right-click a blob container, file share, queue, or table.
4. Click `Manage Stored Access Policies....`
5. Click the trash icon next to a stored access policy.
6. Click `Save`.
7. Repeat steps 1-6 as needed to revoke SAS created with SAP.

### Remediate from Azure Portal

If SAS have been created without a short lifespan and were not created with a SAP, the SAS can be revoked by regenerating the storage account access keys:

Note: Regenerating access keys can affect any applications or Azure services that are dependent on the storage account key.

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Security + networking`, click `Access keys`.
4. Next to each key, click `Rotate key`.
5. Click `Yes` to confirm.
6. Repeat steps 1-5 as needed to revoke SAS.

## Default Value

By default, expiration for shared access signature created from Storage Explorer is set to 24 hours.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-sas-overview
2. https://docs.microsoft.com/en-us/rest/api/storageservices/delegating-access-with-a-shared-access-signature
3. https://learn.microsoft.com/en-us/azure/storage/storage-explorer/vs-azure-tools-storage-explorer-blobs#manage-access-policies-for-a-blob-container

## Additional Information

This recommendation is based on the recommendation `Ensure that shared access signature (SAS) tokens expire within an hour`, from the `Common Reference Recommendations > Secrets and Keys > Shared Access Signatures` section.

## Profile

Level 1 | Manual
