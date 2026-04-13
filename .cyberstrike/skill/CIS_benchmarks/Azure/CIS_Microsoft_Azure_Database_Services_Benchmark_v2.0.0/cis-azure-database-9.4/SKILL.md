---
name: cis-azure-database-9.4
description: "Ensure SQL server's Transparent Data Encryption (TDE) protector is encrypted with Customer-managed key"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, sql-database, sql-server]
cis_id: "9.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.4 Ensure SQL server's Transparent Data Encryption (TDE) protector is encrypted with Customer-managed key (Automated)

## Profile Applicability

- Level 2

## Description

Transparent Data Encryption (TDE) with Customer-managed key support provides increased transparency and control over the TDE Protector, increased security with an HSM-backed external service, and promotion of separation of duties.

With TDE, data is encrypted at rest with a symmetric key (called the database encryption key) stored in the database or data warehouse distribution. To protect this data encryption key (DEK) in the past, only a certificate that the Azure SQL Service managed could be used. Now, with Customer-managed key support for TDE, the DEK can be protected with an asymmetric key that is stored in the Azure Key Vault. The Azure Key Vault is a highly available and scalable cloud-based key store which offers central key management, leverages FIPS 140-2 Level 2 validated hardware security modules (HSMs), and allows separation of management of keys and data for additional security.

Based on business needs or criticality of data/databases hosted on a SQL server, it is recommended that the TDE protector is encrypted by a key that is managed by the data owner (Customer-managed key).

## Rationale

Customer-managed key support for Transparent Data Encryption (TDE) allows user control of TDE encryption keys and restricts who can access them and when. Azure Key Vault, Azure's cloud-based external key management system, is the first key management service where TDE has integrated support for Customer-managed keys. With Customer-managed key support, the database encryption key is protected by an asymmetric key stored in the Key Vault. The asymmetric key is set at the server level and inherited by all databases under that server.

## Impact

Once TDE protector is encrypted with a Customer-managed key, it transfers entire responsibility of respective key management on to you, and hence you should be more careful about doing any operations on the particular key in order to keep data from corresponding SQL server and Databases hosted accessible.

When deploying Customer Managed Keys, it is prudent to ensure that you also deploy an automated toolset for managing these keys (this should include discovery and key rotation), and Keys should be stored in an HSM or hardware backed keystore, such as Azure Key Vault.

## Audit Procedure

### Audit from Azure Portal

1. Go to `SQL servers`.

For the desired server instance:

2. Click On `Transparent data encryption`.
3. Ensure that `Customer-managed key` is selected.
4. Ensure `Make selected key the default TDE protector` is checked.

### Audit from Azure CLI

```bash
az account get-access-token --query "{subscripton:subscription,accessToken:accessToken}" --out tsv | xargs -L1 bash -c 'curl -X GET -H "Authorization: Bearer $1" -H "Content-Type: application/json" https://management.azure.com/subscriptions/$0/resourceGroups/{resourceGroupName}/providers/Microsoft.Sql/servers/{serverName}/encryptionProtector?api-version=2015-05-01-preview'
```

Ensure the output of the command contains properties:
- `kind` set to `azurekeyvault`
- `serverKeyType` set to `AzureKeyVault`
- `uri` is not null

### Audit from PowerShell

```powershell
Get-AzSqlServerTransparentDataEncryptionProtector -ServerName <ServerName> -ResourceGroupName <ResourceGroupName>
```

Ensure the output of the command contains properties:
- `Type` set to `AzureKeyVault`
- `ServerKeyVaultKeyName` set to `KeyVaultName_KeyName_KeyIdentifierVersion`
- `KeyId` set to `KeyIdentifier`

### Audit from Azure Policy

- Policy ID: `0a370ff3-6cab-4e85-8995-295fd854c5b8` - Name: 'SQL servers should use customer-managed keys to encrypt data at rest'
- Policy ID: `ac01ad65-10e5-46df-bdd9-6b0cad13e1d2` - Name: 'SQL managed instances should use customer-managed keys to encrypt data at rest'

## Expected Result

The TDE protector should be encrypted with a Customer-managed key stored in Azure Key Vault.

## Remediation

### Remediate from Azure Console

1. Go to `SQL servers`.

For the desired server instance:

2. Click On `Transparent data encryption`.
3. Set `Transparent data encryption` to `Customer-managed key`.
4. Browse through your `key vaults` to Select an existing key or create a new key in the Azure Key Vault.
5. Check `Make selected key the default TDE protector`.

### Remediate from Azure CLI

Use the below command to encrypt SQL server's TDE protector with a Customer-managed key:

```bash
az sql server tde-key set --resource-group <resourceName> --server <dbServerName> --server-key-type {AzureKeyVault} --kid <keyIdentifier>
```

### Remediate from PowerShell

Use the below command to encrypt SQL server's TDE protector with a Customer-managed Key Vault key:

```powershell
Set-AzSqlServerTransparentDataEncryptionProtector -Type AzureKeyVault -KeyId <KeyIdentifier> -ServerName <ServerName> -ResourceGroupName <ResourceGroupName>
```

Select `Y` when prompted.

## Default Value

By Default, Microsoft managed TDE protector is enabled for a SQL server.

## References

1. https://docs.microsoft.com/en-us/sql/relational-databases/security/encryption/transparent-data-encryption-byok-azure-sql
2. https://azure.microsoft.com/en-in/blog/preview-sql-transparent-data-encryption-tde-with-bring-your-own-key-support/
3. https://winterdom.com/2017/09/07/azure-sql-tde-protector-keyvault
4. https://docs.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required
5. https://docs.microsoft.com/en-us/azure/key-vault/general/basic-concepts
6. https://docs.microsoft.com/en-us/cli/azure/sql/server/tde-key?view=azure-cli-latest
7. https://learn.microsoft.com/en-us/powershell/module/az.sql/get-azsqlservertransparentdataencryptionprotector?view=azps-9.2.0
8. https://learn.microsoft.com/en-us/powershell/module/az.sql/set-azsqlservertransparentdataencryptionprotector?view=azps-9.2.0

## Profile

- Level 2
