---
name: cis-azure-storage-5.2.4
description: "Ensure 'Use infrastructure encryption for this vault' is enabled on Recovery Services vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, encryption, infrastructure-encryption, double-encryption, cmk]
cis_id: "5.2.4"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.4 Ensure 'Use infrastructure encryption for this vault' is enabled on Recovery Services vaults (Automated)

## Description

In addition to using customer-managed keys for encryption at rest in the Recovery Services vault, you can enable an additional layer of platform-managed infrastructure encryption. This dual-layer approach enhances the protection of your backup data.

## Rationale

Enabling infrastructure encryption on an Azure Recovery Services vault adds a second layer of protection to backup data, enhancing security and ensuring compliance for sensitive data storage. This dual-layer strategy reduces the risk of unauthorized access by keeping data encrypted even if one layer is compromised.

## Impact

Enabling infrastructure encryption on an Azure Recovery Services vault does not incur additional costs; however infrastructure encryption must be set when configuring the encryption of the vault for the first time and requires customer-managed keys for encryption at rest. Once configured, the infrastructure encryption setting cannot be changed. This recommendation is linked to `Ensure that backup data in Recovery Services vaults is encrypted using customer-managed keys (CMK)` and should be applied alongside it if you choose to implement this recommendation.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Encryption Settings`, click `Update`.
5. Under `Infrastructure encryption`, ensure the box next to `Use infrastructure encryption for this vault` is checked.
6. Repeat steps 1-5 for each Recovery Services vault.

### Audit from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault, run the following command:

```bash
az backup vault encryption show --resource-group <resource-group> --name <recovery-services-vault>
```

Ensure that `infrastructureEncryptionState` is set to `Enabled`.

### Audit from PowerShell

Run the following command to list Recovery Services vaults:

```powershell
Get-AzRecoveryServicesVault
```

Run the following command to get the Recovery Services vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to get the infrastructure encryption setting for the Recovery Services vault:

```powershell
$vault.Properties.EncryptionProperty.InfrastructureEncryption
```

Ensure that the command returns `Enabled`.
Repeat for each Recovery Services vault.

## Expected Result

- `infrastructureEncryptionState` is set to `Enabled`
- In Azure Portal, `Use infrastructure encryption for this vault` is checked
- PowerShell returns `Enabled` for `$vault.Properties.EncryptionProperty.InfrastructureEncryption`

## Remediation

### Remediate from Azure Portal

After configuring a customer-managed key for encryption, next to `Infrastructure Encryption`, click the radio button next to `Enabled`.

### Remediate from Azure CLI

For each Recovery Services vault requiring remediation, run the following command to assign a customer-managed encryption key and enable infrastructure encryption:

```bash
az backup vault encryption update --resource-group <resource-group> --name <recovery-services-vault> --encryption-key-id <cmk-uri> --mi-system-assigned --infrastructure-encryption Enabled
```

Note: Use `--mi-user-assigned` with the above command to provide a UserAssigned Identity Id.

### Remediate from PowerShell

For each Recovery Services vault requiring remediation, run the following command to assign a customer-managed encryption key and enable infrastructure encryption:

```powershell
Set-AzRecoveryServicesVaultProperty -VaultId <recovery-services-vault-id> -EncryptionKeyId <cmk-uri> -UseSystemAssignedIdentity $true -InfrastructureEncryption
```

Note: Use `-UseSystemAssignedIdentity $false` with the above command and `-UserAssignedIdentity` to provide a UserAssigned Identity Id.

## Default Value

Infrastructure encryption is disabled by default on Azure Recovery Services vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/backup-encryption
2. https://learn.microsoft.com/en-us/cli/azure/backup/vault/encryption
3. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/get-azrecoveryservicesvault
4. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/set-azrecoveryservicesvaultproperty

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | X |

## Profile

Level 2 | Automated
