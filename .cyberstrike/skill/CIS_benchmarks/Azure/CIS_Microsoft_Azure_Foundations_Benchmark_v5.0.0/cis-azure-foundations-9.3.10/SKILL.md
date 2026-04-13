---
name: cis-azure-foundations-9.3.10
description: "Ensure Azure Resource Manager ReadOnly locks are considered for Azure Storage Accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, resource-locks, readonly-lock, data-protection]
cis_id: "9.3.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Azure Resource Manager ReadOnly locks are considered for Azure Storage Accounts

## Description

Adding an Azure Resource Manager `ReadOnly` lock can prevent users from accidentally or maliciously deleting a storage account, modifying its properties and containers, or creating access assignments. The lock must be removed before the storage account can be deleted or updated. It provides more protection than a `CannotDelete`-type of resource manager lock.

This feature prevents `POST` operations on a storage account and containers to the Azure Resource Manager control plane, *management.azure.com*. Blocked operations include `listKeys` which prevents clients from obtaining the account shared access keys.

Microsoft does not recommend `ReadOnly` locks for storage accounts with Azure Files and Table service containers.

This Azure Resource Manager REST API documentation (spec) provides information about the control plane `POST` operations for *Microsoft.Storage* resources.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining storage accounts that require ReadOnly locks depends on the context and requirements of each organization and environment.

## Rationale

Applying a `ReadOnly` lock on storage accounts protects the confidentiality and availability of data by preventing the accidental or unauthorized deletion of the entire storage account and modification of the account, container properties, or access permissions. It can offer enhanced protection for blob and queue workloads with tradeoffs in usability and compatibility for clients using account shared access keys.

## Impact

- Prevents the deletion of the Storage account Resource entirely.
- Prevents the deletion of the parent Resource Group containing the locked Storage account resource.
- Prevents clients from obtaining the storage account shared access keys using a `listKeys` operation.
- Requires Entra credentials to access blob and queue data in the Portal.
- Data in Azure Files or the Table service may be inaccessible to clients using the account shared access keys.
- Prevents modification of account properties, network settings, containers, and RBAC assignments.
- Does not prevent access using existing account shared access keys issued to clients.
- Does not prevent deletion of containers or other objects within the storage account.

## Audit Procedure

### Audit from Azure Portal

1. Navigate to the storage account in the Azure portal.
2. For each storage account, under `Settings`, click `Locks`.
3. Ensure that a `ReadOnly` lock exists on the storage account.

### Audit from Azure CLI

```bash
az lock list --resource-group <resource-group> \
             --resource-name <storage-account> \
             --resource-type "Microsoft.Storage/storageAccounts"
```

### Audit from PowerShell

```powershell
Get-AzResourceLock -ResourceGroupName <RESOURCEGROUPNAME> `
                   -ResourceName <STORAGEACCOUNTNAME> `
                   -ResourceType "Microsoft.Storage/storageAccounts"
```

### Audit from Azure Policy

There is currently no built-in Microsoft policy to audit resource locks on storage accounts. Custom and community policy definitions can check for the existence of a "Microsoft.Authorization/locks" resource with an AuditIfNotExists effect.

## Expected Result

A `ReadOnly` lock should exist on each critical storage account where enhanced protection is desired.

## Remediation

### Remediate from Azure Portal

1. Navigate to the storage account in the Azure portal.
2. Under the `Settings` section, select `Locks`.
3. Select `Add`.
4. Provide a Name, and choose `ReadOnly` for the type of lock.
5. Add a note about the lock if desired.

### Remediate from Azure CLI

Replace the information within <> with appropriate values:

```bash
az lock create --name <lock> \
               --resource-group <resource-group> \
               --resource <storage-account> \
               --lock-type ReadOnly \
               --resource-type Microsoft.Storage/storageAccounts
```

### Remediate from PowerShell

Replace the information within <> with appropriate values:

```powershell
New-AzResourceLock -LockLevel ReadOnly `
                   -LockName <lock> `
                   -ResourceName <storage-account> `
                   -ResourceType Microsoft.Storage/storageAccounts `
                   -ResourceGroupName <resource-group>
```

## Default Value

By default, no locks are applied to Azure resources, including storage accounts. Locks must be manually configured after resource creation.

## References

1. https://learn.microsoft.com/en-us/azure/storage/common/lock-account-resource
2. https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources
3. https://github.com/Azure/azure-rest-api-specs/tree/main/specification/storage

## Profile

Level 2
