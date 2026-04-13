---
name: cis-azure-storage-10.1
description: "Ensure 'Encryption key source' is set to 'Customer Managed Key' for Azure NetApp Files accounts"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, netapp, encryption, cmk]
cis_id: "10.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.1 Ensure 'Encryption key source' is set to 'Customer Managed Key' for Azure NetApp Files accounts (Automated)

## Description

Customer-managed keys (CMK) for Azure NetApp Files volume encryption enable organizations to use their own keys instead of platform-managed ones, providing full control over encryption.

## Rationale

Using customer-managed keys (CMKs) to encrypt Azure NetApp Files volumes enhances security by granting organizations complete control over their encryption keys.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Azure NetApp Files`.
2. Click the name of a NetApp account.
3. Under `Azure NetApp Files`, click `Encryption`.
4. Ensure that `Encryption key source` is set to `Customer Managed Key`.
5. Repeat steps 1-4 for each NetApp Files account.

### Audit from Azure CLI

Run the following command to list NetApp Files accounts:

```bash
az netappfiles account list
```

For each NetApp Files account, run the following command:

```bash
az netappfiles account show --resource-group <resource-group> --account-name <netapp-files-account>
```

Ensure that under `encryption`, `keySource` is set to `Microsoft.KeyVault`.

### Audit from PowerShell

Run the following command to install the `Az.NetAppFiles` module:

```powershell
Install-Module Az.NetAppFiles
```

Enter `Y` when prompted.

Run the following command to list NetApp Files accounts:

```powershell
Get-AzResource | ? {$_.ResourceType -like 'Microsoft.NetApp/netAppAccounts'} | Format-Table
```

Run the following command to get the NetApp Files account in a resource group with a given name:

```powershell
$netapp = Get-AzNetAppFilesAccount -ResourceGroupName <resource-group> -Name <netapp-files-account>
```

Run the following command to get the encryption key source for the NetApp Files account:

```powershell
$netapp.Encryption.KeySource
```

Ensure that the command returns `Microsoft.KeyVault`. Repeat for each NetApp Files account.

## Expected Result

Under `encryption`, `keySource` is set to `Microsoft.KeyVault`.

## Remediation

### Remediate from Azure Portal

1. Go to `Azure NetApp Files`.
2. Click the name of a NetApp account.
3. Under `Azure NetApp Files`, click `Encryption`.
4. Next to `Encryption key source`, click the radio button next to `Customer Managed Key`.
5. Next to `Encryption key`, click the radio button next to `Enter key URI` to provide a known key URI, or click the radio button next to `Select from key vault` to select a key from a key vault.
6. If entering a key URI, provide the key URI in the text box next to `Key URI`.
7. If selecting a key from a key vault, click `Select a key vault and key`.
   1. From the drop-down menu next to `Key vault`, select a key vault.
   2. From the drop-down menu next to `Key`, select a key.
   3. Click `Select`.
8. Next to `Identity type`, click the radio button next to `System-assigned` to use a system-assigned managed identity, or click the radio button next to `User-assigned` to use a user-assigned managed identity.
9. If selecting a user-assigned managed identity, next to `User-assigned identity`, click `Select an identity`.
   1. In the filter box, type to filter by identity name and/or resource group name.
   2. Check the box next to a managed identity.
   3. Click `Add`.
10. Click `Save`.
11. Repeat steps 1-10 for each NetApp Files account.

### Remediate from Azure CLI

For each NetApp Files account requiring remediation, run the following command to assign a customer-managed encryption key:

```bash
az netappfiles account update --resource-group <resource-group> --account-name <netapp-files-account> --key-source Microsoft.KeyVault --key-name <key-name> --key-vault-uri <key-vault-uri> --keyvault-resource-id <key-vault-resource-id> --identity-type SystemAssigned
```

Note: Use `--identity-type UserAssigned --user-assigned-identity <user-assigned-identity-id>` with the above command to provide a UserAssigned Identity Id.

## Default Value

By default, data in the NetApp Files account is encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/azure-netapp-files/configure-customer-managed-keys
2. https://learn.microsoft.com/en-us/cli/azure/netappfiles
3. https://learn.microsoft.com/en-us/powershell/module/az.netappfiles/get-aznetappfilesaccount

## Profile

Level 2 | Automated
