---
name: cis-azure-storage-17.11
description: "Ensure the 'Minimum TLS version' for storage accounts is set to 'Version 1.2'"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, tls]
cis_id: "17.11"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.11 Ensure the 'Minimum TLS version' for storage accounts is set to 'Version 1.2' (Automated)

## Description

In some cases, Azure Storage sets the minimum TLS version to be version 1.0 by default. TLS 1.0 is a legacy version and has known vulnerabilities. This minimum TLS version can be configured to be later protocols such as TLS 1.2.

## Rationale

TLS 1.0 has known vulnerabilities and has been replaced by later versions of the TLS protocol. Continued use of this legacy protocol affects the security of data in transit.

## Impact

When set to TLS 1.2 all requests must leverage this version of the protocol. Applications leveraging legacy versions of the protocol will fail.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Ensure that the `Minimum TLS version` is set to `Version 1.2`.

### Audit from Azure CLI

Get a list of all storage accounts and their resource groups:

```bash
az storage account list | jq '.[] | {name, resourceGroup}'
```

Then query the minimumTLSVersion field:

```bash
az storage account show \
    --name <storage-account> \
    --resource-group <resource-group> \
    --query minimumTlsVersion \
    --output tsv
```

### Audit from PowerShell

To get the minimum TLS version, run the following command:

```powershell
(Get-AzStorageAccount -Name <STORAGEACCOUNTNAME> -ResourceGroupName <RESOURCEGROUPNAME>).MinimumTlsVersion
```

### Audit from Azure Policy

Policy ID: `fe83a0eb-a853-422d-aac2-1bffd182c5d0` - Name: 'Storage accounts should have the specified minimum TLS version'

## Expected Result

The Minimum TLS version should be set to `Version 1.2` (or `TLS1_2` in CLI output) for all storage accounts.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Set the `Minimum TLS version` to `Version 1.2`.
4. Click `Save`.

### Remediate from Azure CLI

```bash
az storage account update \
    --name <storage-account> \
    --resource-group <resource-group> \
    --min-tls-version TLS1_2
```

### Remediate from PowerShell

To set the minimum TLS version, run the following command:

```powershell
Set-AzStorageAccount -AccountName <STORAGEACCOUNTNAME> `
                     -ResourceGroupName <RESOURCEGROUPNAME> `
                     -MinimumTlsVersion TLS1_2
```

## Default Value

If a storage account is created through the portal, the MinimumTlsVersion property for that storage account will be set to TLS 1.2.

If a storage account is created through PowerShell or CLI, the MinimumTlsVersion property for that storage account will not be set, and defaults to TLS 1.0.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/transport-layer-security-configure-minimum-version?tabs=portal
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## Profile

Level 1 | Automated
