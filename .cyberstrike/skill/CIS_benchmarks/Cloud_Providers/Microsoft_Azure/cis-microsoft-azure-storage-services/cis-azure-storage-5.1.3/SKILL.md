---
name: cis-azure-storage-5.1.3
description: "Ensure backup data in Backup vaults is encrypted using customer-managed keys (CMK)"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, encryption, cmk]
cis_id: "5.1.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Ensure backup data in Backup vaults is encrypted using customer-managed keys (CMK) (Automated)

## Description

Backup vaults offer two encryption options: Microsoft-managed keys, which provide automatic encryption without user intervention, and customer-managed keys (CMK), which allow organizations to retain full control over their encryption keys for enhanced security and compliance.

## Rationale

Using customer-managed keys (CMKs) to encrypt Backup vaults enhances security by granting organizations complete control over their encryption keys.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Ensure `Encryption Settings` is set to `Using 'Customer-managed keys'`.
5. Repeat steps 1-4 for each Backup vault.

### Audit from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault, run the following command:

```bash
az dataprotection backup-vault show --resource-group <resource-group> --vault-name <backup-vault>
```

Ensure that under `properties` > `securitySettings` > `encryptionSettings` > `keyVaultProperties`, a key `keyUri` exists with the value set to a customer-managed key URI.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `d6588149-9f06-462c-a076-56aece45b5ba`
- Name: '[Preview]: Azure Backup Vaults should use customer-managed keys for encrypting backup data. Also an option to enforce Infra Encryption.'

## Expected Result

`Encryption Settings` should show `Using 'Customer-managed keys'` in the Azure Portal, or `properties.securitySettings.encryptionSettings.keyVaultProperties.keyUri` should contain a customer-managed key URI in CLI output.

## Remediation

Note: Once encryption is configured to use a customer-managed key, this setting cannot be reversed.

### Remediate from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under `Using 'Microsoft-managed keys'`, click `Update`.
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
11. Repeat steps 1-10 for each Backup vault.

### Remediate from Azure CLI

For each Backup vault requiring remediation, run the following command to assign a customer-managed encryption key:

```bash
az dataprotection backup-vault update --resource-group <resource-group> --vault-name <backup-vault> --cmk-encryption-key-uri <cmk-uri> --cmk-encryption-state "Enabled" --cmk-identity-type "SystemAssigned"
```

Note: Use `--cmk-identity-type "UserAssigned" --cmk-user-assigned-identity-id <user-assigned-identity-id>` with the above command to provide a UserAssigned Identity Id.

## Default Value

By default, data in the Backup vault is encrypted using Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk-for-backup-vault
2. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault
3. https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-manage-user-assigned-managed-identities

## Additional Information

- To enable encryption, it is necessary to grant the Backup vault the appropriate permissions to access the encryption key in the key vault. The key can be modified as needed. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk-for-backup-vault#assign-permissions-to-the-backup-vault-to-access-the-encryption-key-in-azure-key-vault.
- Azure Backup uses system-assigned managed identities and user-assigned managed identities to authenticate the Backup vault to access encryption keys stored in Azure Key Vault. Refer to the following guide for details: https://learn.microsoft.com/en-us/azure/backup/encryption-at-rest-with-cmk-for-backup-vault#enable-a-managed-identity-for-your-backup-vault.

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |

## Profile

Level 2 | Automated
