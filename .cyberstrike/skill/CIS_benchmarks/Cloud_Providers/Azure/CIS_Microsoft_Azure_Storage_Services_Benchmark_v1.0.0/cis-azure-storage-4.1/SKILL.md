---
name: cis-azure-storage-4.1
description: "Ensure 'Key encryption key' is set to a customer-managed key for Azure Managed Lustre file systems"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, managed-lustre, encryption, cmk]
cis_id: "4.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure 'Key encryption key' is set to a customer-managed key for Azure Managed Lustre file systems (Automated)

## Description

Enable customer-managed encryption keys (CMEK) for Azure Managed Lustre file systems to enhance data security and provide greater control over encryption processes. By using CMEK, organizations can manage their own encryption keys within Azure Key Vault, allowing them to rotate, revoke, or otherwise control access to these keys in accordance with their security policies.

## Rationale

Using customer-managed encryption keys (CMEK) gives organizations complete control over encryption keys, ensuring compliance and enhancing data security. CMEK allows for key rotation, revocation, and lifecycle management, thus improving data protection and facilitating immediate control over data access in Azure Managed Lustre file systems.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure Managed Lustre`.
2. Click the name of a file system.
3. Under `Settings`, click `Properties`.
4. Under `Encryption settings`, ensure that the value next to `Key encryption key` is `View value as JSON`.
5. Repeat steps 1-4 for each file system.

### Audit from Azure CLI

Run the following command to list Azure Managed Lustre file systems:

```bash
az amlfs list
```

For each file system, run the following command:

```bash
az amlfs show --resource-group <resource-group> --name <file-system>
```

Ensure that under `encryptionSettings` > `keyEncryptionKey`, `keyUrl` is set to a customer-managed key URL.

### Audit from PowerShell

Run the following command to install the `Az.StorageCache` module:

```powershell
Install-Module Az.StorageCache
```

Enter `Y` when prompted.

Run the following command to list Azure Managed Lustre file systems:

```powershell
Get-AzStorageCacheAmlFileSystem
```

Run the following command to get the file system in a resource group with a given name:

```powershell
$filesystem = Get-AzStorageCacheAmlFileSystem -ResourceGroupName <resource-group> -Name <file-system>
```

Run the following command to get the key encryption key URL for the file system:

```powershell
$filesystem.KeyEncryptionKeyUrl
```

Ensure that the command returns a customer-managed key URL.
Repeat for each file system.

## Expected Result

The `Key encryption key` value should show `View value as JSON` in the Azure Portal, or `encryptionSettings.keyEncryptionKey.keyUrl` should be set to a customer-managed key URL in CLI/PowerShell output.

## Remediation

### Remediate from Azure Portal

To create an Azure Managed Lustre file system that uses a customer-managed encryption key:

1. Go to `Azure Managed Lustre`.
2. Click `+ Create`.
3. Provide the required information on the `Basics` tab.
4. Configure the `Advanced` tab if necessary.
5. Click the `Disk encryption keys` tab.
6. Next to `Disk encryption key type`, select the radio button next to `Customer managed`.
7. Next to `Key vault, key and version`, click `Select or create a key vault, key, or version`.
8. Select a key vault, key, and version.
9. Click `Select`.
10. Next to `User assigned identities`, click `Add user assigned managed identities`.
11. In the filter box, type to filter by identity name and/or resource group name.
12. Check the box next to a managed identity.
13. Click `Add`.
14. Click `Review + create`.
15. Click `Create`.

### Remediate from Azure CLI

Run the following command to create an Azure Managed Lustre file system with a customer-managed encryption key:

```bash
az amlfs create --resource-group <resource-group> --name <file-system> --sku <sku> --storage-capacity <size-in-tib> --zones [<availability-zone>] --maintenance-window "{dayOfWeek:<day>,timeOfDayUtc:'<time>'}" --mi-user-assigned "<user-assigned-identity-id>" --filesystem-subnet "<subnet-id>" --encryption-setting "{'keyUrl': '<key-url>', 'sourceVault': {'id': '<key-vault>'}}"
```

### Remediate from PowerShell

Run the following command to install the `Az.StorageCache` module:

```powershell
Install-Module Az.StorageCache
```

Enter `Y` when prompted.

Run the following command to create an Azure Managed Lustre file system with a customer-managed encryption key:

```powershell
New-AzStorageCacheAmlFileSystem -ResourceGroupName <resource-group> -Name <file-system> -Location <location> -MaintenanceWindowDayOfWeek '<day>' -MaintenanceWindowTimeOfDayUtc "<time>" -FilesystemSubnet "<subnet-id>" -SkuName "<sku>" -StorageCapacityTiB <size-in-tib> -Zone <availability-zone> -IdentityType 'UserAssigned' -IdentityUserAssignedIdentity @{"<user-assigned-identity-id>" = @{}} -KeyEncryptionKeyUrl "<key-url>" -SourceVaultId "<key-vault>"
```

## Default Value

By default, data in Azure Managed Lustre file systems is encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/azure-managed-lustre/customer-managed-encryption-keys
2. https://learn.microsoft.com/en-us/cli/azure/amlfs
3. https://learn.microsoft.com/en-us/powershell/module/az.storagecache/get-azstoragecacheamlfilesystem
4. https://learn.microsoft.com/en-us/powershell/module/az.storagecache/new-azstoragecacheamlfilesystem

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |

## Profile

Level 2 | Automated
