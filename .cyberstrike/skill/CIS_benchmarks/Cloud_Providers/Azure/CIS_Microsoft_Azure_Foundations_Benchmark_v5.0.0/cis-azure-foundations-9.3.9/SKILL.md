---
name: cis-azure-foundations-9.3.9
description: "Ensure Azure Resource Manager Delete locks are applied to Azure Storage Accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, resource-locks, delete-lock, data-protection]
cis_id: "9.3.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Azure Resource Manager Delete locks are applied to Azure Storage Accounts

## Description

Azure Resource Manager _CannotDelete (Delete)_ locks can prevent users from accidentally or maliciously deleting a storage account. This feature ensures that while the Storage account can still be modified or used, deletion of the Storage account resource requires removal of the lock by a user with appropriate permissions.

This feature is a protective control for the availability of data. By ensuring that a storage account or its parent resource group cannot be deleted without first removing the lock, the risk of data loss is reduced.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Determining storage accounts that require CannotDelete locks depends on the context and requirements of each organization and environment.

## Rationale

Applying a _Delete_ lock on storage accounts protects the availability of data by preventing the accidental or unauthorized deletion of the entire storage account. It is a fundamental protective control that can prevent data loss.

## Impact

- Prevents the deletion of the Storage account Resource entirely.
- Prevents the deletion of the parent Resource Group containing the locked Storage account resource.
- Does not prevent other control plane operations, including modification of configurations, network settings, containers, and access.
- Does not prevent deletion of containers or other objects within the storage account.

## Audit Procedure

### Audit from Azure Portal

1. Navigate to the storage account in the Azure portal.
2. For each storage account, under `Settings`, click `Locks`.
3. Ensure that a `Delete` lock exists on the storage account.

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

A `Delete` (CannotDelete) lock should exist on each critical storage account.

## Remediation

### Remediate from Azure Portal

1. Navigate to the storage account in the Azure portal.
2. Under the `Settings` section, select `Locks`.
3. Select `Add`.
4. Provide a Name, and choose `Delete` for the type of lock.
5. Add a note about the lock if desired.

### Remediate from Azure CLI

Replace the information within <> with appropriate values:

```bash
az lock create --name <lock> \
               --resource-group <resource-group> \
               --resource <storage-account> \
               --lock-type CanNotDelete \
               --resource-type Microsoft.Storage/storageAccounts
```

### Remediate from PowerShell

Replace the information within <> with appropriate values:

```powershell
New-AzResourceLock -LockLevel CanNotDelete `
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

## Profile

Level 1
