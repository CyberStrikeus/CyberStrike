---
name: cis-azure-storage-5.1.4
description: "Ensure 'Use infrastructure encryption for this vault' is enabled on Backup vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, encryption, infrastructure-encryption]
cis_id: "5.1.4"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Ensure 'Use infrastructure encryption for this vault' is enabled on Backup vaults (Automated)

## Description

In addition to using customer-managed keys for encryption at rest in the Backup vault, you can enable an additional layer of platform-managed infrastructure encryption. This dual-layer approach enhances the protection of your backup data.

## Rationale

Enabling infrastructure encryption on a Backup vault adds a second layer of protection to backup data, enhancing security and ensuring compliance for sensitive data storage. This dual-layer strategy reduces the risk of unauthorized access by keeping data encrypted even if one layer is compromised.

## Impact

Enabling infrastructure encryption on a backup vault does not incur additional costs; however, infrastructure encryption must be configured when creating the vault and requires customer-managed keys for encryption at rest. This recommendation is linked to `Ensure backup data in Backup vaults is encrypted using customer-managed keys (CMK)` and should be applied alongside it if you choose to implement this recommendation.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under `Encryption Settings`, click `Update`.
5. Under `Infrastructure encryption`, ensure the box next to `Use infrastructure encryption for this vault` is checked.
6. Repeat steps 1-5 for each Backup vault.

### Audit from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault, run the following command:

```bash
az dataprotection backup-vault show --resource-group <resource-group> --vault-name <backup-vault>
```

Ensure that under `properties` > `securitySettings` > `encryptionSettings`, `infrastructureEncryption` is set to `Enabled`.

### Audit from PowerShell

Run the following command to list Backup vaults:

```powershell
Get-AzDataProtectionBackupVault
```

Run the following command to get the Backup vault in a resource group with a given name:

```powershell
$vault = Get-AzDataProtectionBackupVault -ResourceGroupName <resource-group> -VaultName <backup-vault>
```

Run the following command to get the infrastructure encryption setting for the Backup vault:

```powershell
$vault.EncryptionSetting.CmkInfrastructureEncryption
```

Ensure that the command returns `Enabled`.
Repeat for each Backup vault.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `d6588149-9f06-462c-a076-56aece45b5ba`
- Name: '[Preview]: Azure Backup Vaults should use customer-managed keys for encrypting backup data. Also an option to enforce Infra Encryption.'

## Expected Result

`Infrastructure encryption` should be checked/enabled in the Azure Portal, or `properties.securitySettings.encryptionSettings.infrastructureEncryption` should be `Enabled` in CLI output, or `$vault.EncryptionSetting.CmkInfrastructureEncryption` should return `Enabled` in PowerShell.

## Remediation

### Remediate from Azure CLI

Run the following command to create a locally redundant Backup vault with a customer-managed encryption key and infrastructure encryption enabled:

```bash
az dataprotection backup-vault create --resource-group <resource-group> --vault-name <backup-vault> --location <location> --storage-setting "[{type:'LocallyRedundant',datastore-type:'VaultStore'}]" --type "UserAssigned" --user-assigned-identities '{"<user-assigned-identity-id>":{}}' --cmk-encryption-key-uri <cmk-uri> --cmk-encryption-state Enabled --cmk-identity-type "UserAssigned" --cmk-user-assigned-identity-id <cmk-user-assigned-identity-id> --cmk-infrastructure-encryption Enabled
```

### Remediate from PowerShell

Run the following commands to create a locally redundant Backup vault with a customer-managed encryption key and infrastructure encryption enabled:

```powershell
$sub = "<subscription-id>"

$storagesetting = New-AzDataProtectionBackupVaultStorageSettingObject -DataStoreType VaultStore -Type LocallyRedundant

$userAssignedIdentity = @{
    "<user-assigned-identity-id>" = @{
        clientId = "<user-assigned-identity-client-id>"
        principalId = "<user-assigned-identity-principal-id>"
    }
}

$cmkIdentityId = "<cmk-user-assigned-identity-id>"

$cmkKeyUri = "<cmk-uri>"

New-AzDataProtectionBackupVault -SubscriptionId $sub -ResourceGroupName <resource-group> -VaultName <backup-vault> -Location <location> -StorageSetting $storagesetting -IdentityType UserAssigned -UserAssignedIdentity $userAssignedIdentity -CmkEncryptionState Enabled -CmkIdentityType UserAssigned -CmkUserAssignedIdentityId $cmkIdentityId -CmkEncryptionKeyUri $cmkKeyUri -CmkInfrastructureEncryption Enabled
```

## Default Value

Infrastructure encryption is disabled by default on Backup vaults.

## References

1. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault
2. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/get-azdataprotectionbackupvault
3. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/new-azdataprotectionbackupvault
4. https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities

## Additional Information

Backup vaults use user-assigned managed identities to authenticate the Backup vault to access encryption keys stored in Azure Key Vault when creating the vault with a customer-managed encryption key and infrastructure encryption enabled. Refer to the following guides for details:

- https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities
- https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk-for-backup-vault

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | X |

## Profile

Level 2 | Automated
