---
name: cis-azure-storage-17.1.5
description: "Ensure 'Allow storage account key access' for Azure Storage Accounts is 'Disabled'"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, keys, encryption]
cis_id: "17.1.5"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.1.5 Ensure 'Allow storage account key access' for Azure Storage Accounts is 'Disabled' (Automated)

## Description

Every secure request to an Azure Storage account must be authorized. By default, requests can be authorized with either Microsoft Entra credentials or by using the account access key for Shared Key authorization.

## Rationale

Microsoft Entra ID provides superior security and ease of use compared to Shared Key and is recommended by Microsoft. To require clients to use Microsoft Entra ID for authorizing requests, you can disallow requests to the storage account that are authorized with Shared Key.

## Impact

When you disallow Shared Key authorization for a storage account, any requests to the account that are authorized with Shared Key, including shared access signatures (SAS), will be denied. Client applications that currently access the storage account using the Shared Key will no longer function.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Settings`, click `Configuration`.
4. Under `Allow storage account key access`, ensure that the radio button next to `Disabled` is selected.
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

Ensure that `allowSharedKeyAccess` is set to `false`.

### Audit from PowerShell

Run the following command to list storage accounts:

```powershell
Get-AzStorageAccount
```

Run the following command to get the storage account in a resource group with a given name:

```powershell
$storageAccount = Get-AzStorageAccount -ResourceGroupName <resource-group> -Name <storage-account>
```

Run the following command to get the shared key access setting for the storage account:

```powershell
$storageAccount.allowSharedKeyAccess
```

Ensure that the command returns `False`. Repeat for each storage account.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure. If referencing a printed copy, you can search Policy IDs from this URL: https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `8c6a50c6-9ffd-4ae7-986f-5fa6111f9a54`
- Name: 'Storage accounts should prevent shared key access'

## Expected Result

The `Allow storage account key access` setting is set to `Disabled` in the Azure Portal for each storage account. In Azure CLI, `allowSharedKeyAccess` returns `false`. In PowerShell, `$storageAccount.allowSharedKeyAccess` returns `False`. The Azure Policy 'Storage accounts should prevent shared key access' shows compliant.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click on a storage account.
3. Under `Settings`, click `Configuration`.
4. Under `Allow storage account key access`, click the radio button next to `Disabled`.
5. Click `Save`.
6. Repeat steps 1-5 for each storage account requiring remediation.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to disallow shared key authorization:

```bash
az storage account update --resource-group <resource-group> --name <storage-account> --allow-shared-key-access false
```

### Remediate from PowerShell

For each storage account requiring remediation, run the following command to disallow shared key authorization:

```powershell
Set-AzStorageAccount -ResourceGroupName <resource-group> -Name <storage-account> -AllowSharedKeyAccess $false
```

## Default Value

The AllowSharedKeyAccess property of a storage account is not set by default and does not return a value until you explicitly set it. The storage account permits requests that are authorized with the Shared Key when the property value is null or when it is true.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent
2. https://learn.microsoft.com/en-us/cli/azure/storage/account
3. https://learn.microsoft.com/en-us/powershell/module/az.storage/get-azstorageaccount
4. https://learn.microsoft.com/en-us/powershell/module/az.storage/set-azstorageaccount

## Profile

Level 1 | Automated
