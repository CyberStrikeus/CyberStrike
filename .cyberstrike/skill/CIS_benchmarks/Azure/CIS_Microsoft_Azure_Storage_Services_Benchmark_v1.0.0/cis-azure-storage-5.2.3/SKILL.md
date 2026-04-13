---
name: cis-azure-storage-5.2.3
description: "Ensure backup data in Recovery Services vaults is encrypted using customer-managed keys (CMK)"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, encryption, cmk, customer-managed-keys, key-vault]
cis_id: "5.2.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.3 Ensure backup data in Recovery Services vaults is encrypted using customer-managed keys (CMK) (Automated)

## Description

Recovery Services vaults offer two encryption options: Microsoft-managed keys, which provide automatic encryption without user intervention, and customer-managed keys (CMK), which allow organizations to retain full control over their encryption keys for enhanced security and compliance.

## Rationale

Using customer-managed keys (CMKs) to encrypt Recovery Services vaults enhances security by granting organizations complete control over their encryption keys.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Encryption Settings`, click `Update`.
5. Ensure the box next to `Use your own key` is checked, and a key URI is displayed under `Encryption key`.
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

Ensure that under `properties`, `encryptionAtRestType` is set to `CustomerManaged`, and a key `keyUri` exists with the value set to a customer-managed key URI.

### Audit from PowerShell

Run the following command to list Recovery Services vaults:

```powershell
Get-AzRecoveryServicesVault
```

Run the following command to get the Recovery Services vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to get the encryption setting for the Recovery Services vault:

```powershell
$vault.Properties.EncryptionProperty.KeyVaultProperties
```

Ensure that the command returns a customer-managed key URI.
Repeat for each Recovery Services vault.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `2e94d99a-8a36-4563-bc77-810d8893b671`
- Name: '[Preview]: Azure Recovery Services vaults should use customer-managed keys for encrypting backup data'

## Expected Result

- `properties.encryptionAtRestType` is set to `CustomerManaged`
- A `keyUri` exists with the value set to a customer-managed key URI
- In Azure Portal, `Use your own key` is checked and a key URI is displayed under `Encryption key`

## Remediation

Note: Once encryption is configured to use a customer-managed key, this setting cannot be reversed.

### Remediate from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Encryption Settings`, click `Update`.
5. Check the box next to `Use your own key`.
6. Under `Encryption key`, click the radio button next to `Enter key URI` to provide a known key URI, or click the radio button next to `Select from Key Vault` to select a key from a Key Vault.
7. If entering a key URI, provide the key URI in the text box under `Key URI`.
8. If selecting a key from a Key Vault, click `select key from Key Vault`.
    1. Select `Key vault` or `Managed HSM`.
    2. Select a key vault or managed HSM.
    3. Select a key.
    4. Click `Select`.
9. Select a managed identity to use for the encryption key.
10. Click `Update`.
11. Repeat steps 1-10 for each Recovery Services vault.

### Remediate from Azure CLI

For each Recovery Services vault requiring remediation, run the following command to assign a customer-managed encryption key:

```bash
az backup vault encryption update --resource-group <resource-group> --name <recovery-services-vault> --encryption-key-id <cmk-uri> --mi-system-assigned
```

Note: Use `--mi-user-assigned` with the above command to provide a UserAssigned Identity Id.

### Remediate from PowerShell

For each Recovery Services vault requiring remediation, run the following command to assign a customer-managed encryption key:

```powershell
Set-AzRecoveryServicesVaultProperty -VaultId <recovery-services-vault-id> -EncryptionKeyId <cmk-uri> -UseSystemAssignedIdentity $true
```

Note: Use `-UseSystemAssignedIdentity $false` with the above command and `-UserAssignedIdentity` to provide a UserAssigned Identity Id.

## Default Value

By default, data in the Recovery Services vault is encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk
2. https://learn.microsoft.com/en-us/cli/azure/backup/vault
3. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/get-azrecoveryservicesvault
4. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/set-azrecoveryservicesvaultproperty
5. https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities

### Additional Information

- This feature can only be applied to new Recovery Services vaults. Unfortunately, vaults that currently contain existing items that are registered or have previously attempted registration are not supported.
- To enable encryption, it is necessary to grant the Recovery Services vault the appropriate permissions to access the encryption key in the key vault. The key can be modified as needed. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk#assign-permissions-to-the-recovery-services-vault-to-access-the-encryption-key-in-azure-key-vault.
- Azure Backup uses system-assigned managed identities and user-assigned managed identities to authenticate the Recovery Services vault to access encryption keys stored in Azure Key Vault. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk#enable-a-managed-identity-for-your-recovery-services-vault.

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | X | X |
| v7 | 14.8 Encrypt Sensitive Information at Rest - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information. | | | X |

## Profile

Level 2 | Automated
