---
name: cis-azure-foundations-9.3.11
description: "Ensure Redundancy is set to 'geo-redundant storage (GRS)' on critical Azure Storage Accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, geo-redundancy, grs, disaster-recovery, availability]
cis_id: "9.3.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Redundancy is set to 'geo-redundant storage (GRS)' on critical Azure Storage Accounts

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

Ensure that the command returns `Standard_GRS`.

## Expected Result

`sku.name` should be `Standard_GRS` for all critical storage accounts.

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

## Default Value

The default redundancy setting depends on how the storage account was created and the SKU selected at creation time.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection

## Profile

Level 2
