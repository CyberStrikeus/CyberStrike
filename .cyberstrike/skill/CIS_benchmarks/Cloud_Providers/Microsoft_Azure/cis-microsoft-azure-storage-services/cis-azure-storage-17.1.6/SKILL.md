---
name: cis-azure-storage-17.1.6
description: "Ensure Storage for Critical Data are Encrypted with Customer Managed Keys (CMK)"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, cmk, encryption]
cis_id: "17.1.6"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.1.6 Ensure Storage for Critical Data are Encrypted with Customer Managed Keys (CMK) (Manual)

## Description

Enable sensitive data encryption at rest using Customer Managed Keys (CMK) rather than Microsoft Managed keys.

## Rationale

By default, data in the storage account is encrypted using Microsoft Managed Keys at rest. All Azure Storage resources are encrypted, including blobs, disks, files, queues, and tables. All object metadata is also encrypted. If you want to control and manage this encryption key yourself, however, you can specify a customer-managed key. That key is used to protect and control access to the key that encrypts your data. You can also choose to automatically update the key version used for Azure Storage encryption whenever a new version is available in the associated Key Vault.

While it is possible to automate the assessment of this recommendation, the assessment status for this recommendation remains 'Manual.' This is because the recommendation pertains to storage accounts that store critical data and is therefore not applicable to all storage accounts.

## Impact

If the key expires by setting the 'activation date' and 'expiration date', the user must rotate the key manually.

Using Customer Managed Keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`
2. For each storage account, under `Security + networking`, go to `Encryption`
3. Ensure that `Encryption type` is set to `Customer-managed keys`

### Audit from PowerShell

```powershell
Connect-AzAccount
Set-AzContext -Subscription <subscription id>
Get-AzStorageAccount |Select-Object -ExpandProperty Encryption
```

**PowerShell Results - Non-Compliant:**

```
KeySource                    : Microsoft.Storage
```

**PowerShell Results - Compliant:**

```
KeySource                    : Microsoft.Keyvault
```

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure. If referencing a printed copy, you can search Policy IDs from this URL: https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `6fac406b-40ca-413b-bf8e-0bf964659c25`
- Name: 'Storage accounts should use customer-managed key for encryption'

## Expected Result

The `Encryption type` is set to `Customer-managed keys` in the Azure Portal for each storage account containing critical data. In PowerShell, the `KeySource` property returns `Microsoft.Keyvault` instead of `Microsoft.Storage`. The Azure Policy 'Storage accounts should use customer-managed key for encryption' shows compliant.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`
2. For each storage account, under `Security + networking`, go to `Encryption`
3. Set `Encryption type` to `Customer-managed keys`
4. Select an encryption key or enter a key URI
5. Click `Save`

## Default Value

By default, Encryption type is set to Microsoft Managed Keys.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-service-encryption
2. https://docs.microsoft.com/en-us/azure/security/fundamentals/data-encryption-best-practices#protect-data-at-rest
3. https://docs.microsoft.com/en-us/azure/storage/common/storage-service-encryption#azure-storage-encryption-versus-disk-encryption
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required

## Profile

Level 2 | Manual
