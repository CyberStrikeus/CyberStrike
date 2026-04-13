---
name: cis-azure-foundations-9.2.3
description: "Ensure 'Versioning' is set to 'Enabled' on Azure Blob Storage storage accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, blob-storage, storage, versioning, data-protection]
cis_id: "9.2.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Versioning' is set to 'Enabled' on Azure Blob Storage storage accounts

## Description

Enabling blob versioning allows for the automatic retention of previous versions of objects. With blob versioning enabled, earlier versions of a blob are accessible for data recovery in the event of modifications or deletions.

## Rationale

Blob versioning safeguards data integrity and enables recovery by retaining previous versions of stored objects, facilitating quick restoration from accidental deletion, modification, or malicious activity.

## Impact

Enabling blob versioning for a storage account creates a new version with each write operation to a blob, which can increase storage costs. To control these costs, a lifecycle management policy can be applied to automatically delete older versions.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account with blob storage.
3. In the `Overview` page, on the `Properties` tab, under `Blob service`, ensure `Versioning` is set to `Enabled`.
4. Repeat steps 1-3 for each storage account with blob storage.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

Run the following command to determine if a storage account has containers:

```bash
az storage container list --account-name <storage-account>
```

For each storage account with containers, ensure that the output of the below command contains `"isVersioningEnabled": true`:

```bash
az storage account blob-service-properties show --account-name <storage-account>
```

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount
```

Run the following command to create an Azure Storage context for a storage account:

```powershell
$context = New-AzStorageContext -StorageAccountName <storage-account>
```

Run the following command to list containers for the storage account:

```powershell
Get-AzStorageContainer -Context $context
```

If the storage account has containers, run the following command to get the blob service properties of the storage account:

```powershell
$account = Get-AzStorageBlobServiceProperty -ResourceGroupName <resource-group> -StorageAccountName <storage-account>
```

Run the following command to get the blob versioning setting for the storage account:

```powershell
$account.IsVersioningEnabled
```

Ensure that the command returns `True`.

## Expected Result

`isVersioningEnabled` should be `true` for all storage accounts with blob storage.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account with blob storage.
3. In the `Overview` page, on the `Properties` tab, under `Blob service`, click `Disabled` next to `Versioning`.
4. Under `Tracking`, check the box next to `Enable versioning for blobs`.
5. Select the radio button next to `Keep all versions` or `Delete versions after (in days)`.
6. If selecting to delete versions, enter a number of in the box after which to delete blob versions.
7. Click `Save`.
8. Repeat steps 1-7 for each storage account with blob storage.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to enable blob versioning:

```bash
az storage account blob-service-properties update --account-name <storage-account> --enable-versioning true
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to enable blob versioning:

```powershell
Update-AzStorageBlobServiceProperty -ResourceGroupName <resource-group> -StorageAccountName <storage-account> -IsVersioningEnabled $true
```

## Default Value

Blob versioning is disabled by default on storage accounts.

## References

1. https://learn.microsoft.com/en-us/cli/azure/storage/account
2. https://learn.microsoft.com/en-us/cli/azure/storage/account/blob-service-properties
3. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstorageaccount
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/new-azstoragecontext
5. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstoragecontainer
6. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstorageblobserviceproperty
7. https://learn.microsoft.com/en-us/powershell/module/az.storage/update-azstorageblobserviceproperty
8. https://learn.microsoft.com/en-us/azure/storage/blobs/versioning-overview
9. https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview

## Profile

Level 2
