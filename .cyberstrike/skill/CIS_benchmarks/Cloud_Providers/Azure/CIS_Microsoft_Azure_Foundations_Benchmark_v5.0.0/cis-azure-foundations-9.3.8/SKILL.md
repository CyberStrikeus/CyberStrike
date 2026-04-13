---
name: cis-azure-foundations-9.3.8
description: "Ensure 'Allow Blob Anonymous Access' is set to 'Disabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, blob-storage, anonymous-access, public-access]
cis_id: "9.3.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Allow Blob Anonymous Access' is set to 'Disabled'

## Description

The Azure Storage setting 'Allow Blob Anonymous Access' (aka "allowBlobPublicAccess") controls whether anonymous access is allowed for blob data in a storage account. When this property is set to True, it enables public read access to blob data, which can be convenient for sharing data but may carry security risks. When set to False, it disallows public access to blob data, providing a more secure storage environment.

## Rationale

If "Allow Blob Anonymous Access" is enabled, blobs can be accessed by adding the blob name to the URL to see the contents. An attacker can enumerate a blob using methods, such as brute force, and access them.

Exfiltration of data by brute force enumeration of items from a storage account may occur if this setting is set to 'Enabled'.

## Impact

Additional consideration may be required for exceptional circumstances where elements of a storage account require public accessibility. In these circumstances, it is highly recommended that all data stored in the public facing storage account be reviewed for sensitive or potentially compromising data, and that sensitive or compromising data is never stored in these storage accounts.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Ensure `Allow Blob Anonymous Access` is set to `Disabled`.

### Audit from Azure CLI

For every storage account in scope:

```bash
az storage account show --name "<yourStorageAccountName>" --query allowBlobPublicAccess
```

Ensure that every storage account in scope returns `false` for the "allowBlobPublicAccess" setting.

## Expected Result

`allowBlobPublicAccess` should be `false` for all storage accounts.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Set `Allow Blob Anonymous Access` to `Disabled`.
4. Click `Save`.

### Remediate from PowerShell

For every storage account in scope, run the following:

```powershell
$storageAccount = Get-AzStorageAccount -ResourceGroupName "<yourResourceGroup>" -Name "<yourStorageAccountName>"
$storageAccount.AllowBlobPublicAccess = $false
Set-AzStorageAccount -InputObject $storageAccount
```

## Default Value

Disabled

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-prevent?tabs=portal
2. https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-prevent?source=recommendations&tabs=portal

## Profile

Level 1
