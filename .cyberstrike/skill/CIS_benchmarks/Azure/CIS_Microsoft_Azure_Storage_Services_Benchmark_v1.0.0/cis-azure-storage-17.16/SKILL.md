---
name: cis-azure-storage-17.16
description: "Ensure Redundancy is set to 'geo-redundant storage (GRS)' on critical Azure Storage Accounts"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, redundancy]
cis_id: "17.16"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.16 Ensure Redundancy is set to 'geo-redundant storage (GRS)' on critical Azure Storage Accounts (Automated)

## Description

Geo-redundant storage (GRS) in Azure replicates data three times within the primary region using locally redundant storage (LRS) and asynchronously copies it to a secondary region hundreds of miles away. This setup ensures high availability and resilience by providing 16 nines (99.99999999999999%) durability over a year, safeguarding data against regional outages.

## Rationale

Enabling GRS protects critical data from regional failures by maintaining a copy in a geographically separate location. This significantly reduces the risk of data loss, supports business continuity, and meets high availability requirements for disaster recovery.

## Impact

Enabling geo-redundant storage on Azure storage accounts increases costs due to cross-region data replication.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Data management`, click `Redundancy`.
4. Ensure that `Redundancy` is set to `Geo-redundant storage (GRS)`.
5. Repeat steps 1-4 for each storage account.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

For each storage account, run the following command:

```bash
az storage account show --resource-group <resource-group> --name <storage-account>
```

Under `sku`, ensure that `name` is set to `Standard_GRS`.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount
```

Run the following command to get the storage account in a resource group with a given name:

```powershell
$storageAccount = Get-AzStorageAccount -ResourceGroupName <resource-group> -Name <storage-account>
```

Run the following command to get the redundancy setting for the storage account:

```powershell
$storageAccount.SKU.Name
```

Ensure that the command returns `Standard_GRS`. Repeat for each storage account.

### Audit from Azure Policy

Policy ID: `bf045164-79ba-4215-8f95-f8048dc1780b`
Name: 'Geo-redundant storage should be enabled for Storage Accounts'

## Expected Result

The redundancy setting should be `Geo-redundant storage (GRS)` for all critical storage accounts. CLI output should show `Standard_GRS` under `sku.name`. PowerShell should return `Standard_GRS`.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Data management`, click `Redundancy`.
4. From the `Redundancy` drop-down menu, select `Geo-redundant storage (GRS)`.
5. Click `Save`.
6. Repeat steps 1-5 for each storage account requiring remediation.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to enable geo-redundant storage:

```bash
az storage account update --resource-group <resource-group> --name <storage-account> --sku Standard_GRS
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to enable geo-redundant storage:

```powershell
Set-AzStorageAccount -ResourceGroupName <resource-group> -Name <storage-account> -SkuName "Standard_GRS"
```

## Default Value

When creating a storage account in the Azure Portal, the default redundancy setting is geo-redundant storage (GRS). Using the Azure CLI, the default is read-access geo-redundant storage (RA-GRS). In PowerShell, a redundancy level must be explicitly specified during account creation.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy
2. https://learn.microsoft.com/en-us/azure/storage/common/redundancy-migration
3. https://learn.microsoft.com/en-us/cli/azure/storage/account?view=azure-cli-latest#az-storage-account-update
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/set-azstorageaccount?view=azps-12.4.0
5. https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance

## Additional Information

When choosing the best redundancy option, weigh the trade-offs between lower costs and higher availability. Key factors to consider include:

- The method of data replication within the primary region.
- The replication of data from a primary to a geographically distant secondary region for protection against regional disasters (geo-replication).
- The necessity for read access to replicated data in the secondary region during an outage in the primary region (geo-replication with read access).

## Profile

Level 2 | Automated
