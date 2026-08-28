---
name: cis-azure-storage-18.2
description: "Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-explorer, sas]
cis_id: "18.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 18.2 Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens (Manual)

## Description

Use stored access policies (SAP) when generating shared access signature (SAS) tokens in Azure to centrally manage permissions, expiration, and revocation settings for resource access. Stored access policies can be applied to blob containers, file shares, queues, and tables.

## Rationale

Stored access policies provide centralized control over SAS token access, allowing administrators to update permissions or revoke access. This approach strengthens security by reducing the risk of unauthorized access to storage resources.

## Impact

There is no cost for creating stored access policies, however there is some administrative overhead involved in managing these policies.

## Audit Procedure

It is not currently possible to retrieve a list of all generated SAS tokens to check if they were associated with a SAP during creation.

An SAS token that has been created with a SAP will contain an `si` parameter that references the stored access policy identifier associated with the SAS, e.g. `si=<stored-access-policy-identifier>`.

The `si` parameter will be absent from an SAS token created without a SAP.

## Expected Result

All SAS tokens should contain the `si` parameter referencing a stored access policy identifier. SAS tokens without the `si` parameter are not associated with a stored access policy and are non-compliant.

## Remediation

### Remediate from Storage Explorer

To create a SAP:

1. In Storage Explorer, expand `Storage Accounts`.
2. Expand a storage account.
3. Expand `Blob Containers`, `File Shares`, `Queues`, or `Tables`, and right-click a blob container, file share, queue, or table.
4. Click `Manage Stored Access Policies....`
5. Under `Access Policies`, click `Add`.
6. Modify the `ID`, `Start time`, `Expiry time`, and permissions appropriately.
7. Click `Save`.
8. Repeat steps 1-7 as needed to create SAP.

When generating SAS, select a SAP from the `Access policy` drop-down.

### Remediate from Azure Portal

If SAS have been created without a SAP, the SAS can be revoked by regenerating the storage account access keys:

Note: Regenerating access keys can affect any applications or Azure services that are dependent on the storage account key.

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Security + networking`, click `Access keys`.
4. Next to each key, click `Rotate key`.
5. Click `Yes` to confirm.
6. Repeat steps 1-5 as needed to revoke SAS.

## Default Value

By default, stored access policies are not associated with SAS. To use a stored access policy, it must be explicitly created and linked to the SAS at the time of creation.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview#best-practices-when-using-sas
2. https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy
3. https://learn.microsoft.com/en-us/azure/storage/storage-explorer/vs-azure-tools-storage-explorer-blobs#manage-access-policies-for-a-blob-container

## Additional Information

This recommendation is based on the recommendation `Ensure stored access policies (SAP) are used when generating shared access signature (SAS) tokens`, from the `Common Reference Recommendations > Secrets and Keys > Shared Access Signatures` section.

## Profile

Level 1 | Manual
