---
name: cis-azure-storage-8.1
description: "Ensure soft delete for Azure File Shares is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, azure-files, soft-delete]
cis_id: "8.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1 Ensure soft delete for Azure File Shares is Enabled (Automated)

## Description

Azure Files offers soft delete for file shares, allowing you to easily recover your data when it is mistakenly deleted by an application or another storage account user.

## Rationale

Important data could be accidentally deleted or removed by a malicious actor. With soft delete enabled, the data is retained for the defined retention period before permanent deletion, allowing for recovery of the data.

## Impact

When a file share is soft-deleted, the used portion of the storage is charged for the indicated soft-deleted period. All other meters are not charged unless the share is restored.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account with file shares, under `Data storage`, click on `File shares`.
3. Under `File share settings`, ensure the value for `Soft delete` shows a number of days between 1 and 365, inclusive.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

Run the following command to determine if a storage account has file shares:

```bash
az storage share list --account-name <storage-account>
```

For each storage account with file shares, run the following command:

```bash
az storage account file-service-properties show --resource-group <resource-group> --account-name <storage-account>
```

Ensure that under `shareDeleteRetentionPolicy`, `enabled` is set to `true`, and `days` is set to an appropriate value between 1 and 365, inclusive.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount -ResourceGroupName <resource-group>
```

With a storage account context set, run the following command to determine if a storage account has file shares:

```powershell
Get-AzStorageShare
```

For each storage account with file shares, run the following command:

```powershell
Get-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -AccountName <storage-account>
```

Ensure that `ShareDeleteRetentionPolicy.Enabled` is set to `True` and `ShareDeleteRetentionPolicy.Days` is set to an appropriate value between 1 and 365, inclusive.

## Expected Result

`shareDeleteRetentionPolicy.enabled` is `true` and `shareDeleteRetentionPolicy.days` is set to an appropriate value between 1 and 365, inclusive.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account with file shares, under `Data storage`, click `File shares`.
3. Under `File share settings`, click the value next to `Soft delete`.
4. Under `Soft delete for all file shares`, click the toggle to set it to `Enabled`.
5. Under `Retention policies`, set an appropriate number of days to retain soft deleted data between 1 and 365, inclusive.
6. Click `Save`.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to enable soft delete for file shares and set an appropriate number of days for deleted data to be retained, between 1 and 365, inclusive:

```bash
az storage account file-service-properties update --account-name <storage-account> --enable-delete-retention true --delete-retention-days <retention-days>
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to enable soft delete for file shares and set an appropriate number of days for deleted data to be retained, between 1 and 365, inclusive:

```powershell
Update-AzStorageFileServiceProperty -ResourceGroupName <resource-group> -AccountName <storage-account> -EnableShareDeleteRetentionPolicy $true -ShareRetentionDays <retention-days>
```

## Default Value

Soft delete is enabled by default at the storage account file share setting level.

## References

1. https://learn.microsoft.com/en-us/azure/storage/files/storage-files-enable-soft-delete
2. https://learn.microsoft.com/en-us/cli/azure/storage/account/file-service-properties
3. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstoragefileserviceproperty
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/update-azstoragefileserviceproperty
5. https://learn.microsoft.com/en-us/azure/storage/files/storage-files-prevent-file-share-deletion

## Profile

Level 1 | Automated
