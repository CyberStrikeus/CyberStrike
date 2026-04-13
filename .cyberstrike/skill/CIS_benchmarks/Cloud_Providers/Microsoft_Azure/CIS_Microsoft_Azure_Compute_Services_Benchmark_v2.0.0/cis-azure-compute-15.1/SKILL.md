---
name: cis-azure-compute-15.1
description: "Ensure Batch account is set to use customer-managed keys to encrypt data"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.1"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Batch account is set to use customer-managed keys to encrypt data

## Description

Customer-managed keys introduce additional depth to security by providing a means to manage access control for encryption keys. Where compliance and security frameworks indicate the need, and organizational capacity allows, sensitive data at rest can be encrypted using customer-managed keys (CMK) rather than Microsoft-managed keys.

While it is possible to automate the assessment of this recommendation, the assessment status for this recommendation remains 'Manual' due to ideally limited scope. The scope of application -- which workloads CMK is applied to -- should be carefully considered to account for organizational capacity and targeted to workloads with specific need for CMK.

## Rationale

By default in Azure, data at rest tends to be encrypted using Microsoft-managed keys. If your organization wants to control and manage encryption keys for compliance and defense-in-depth, customer-managed keys can be established.

## Impact

If the key expires due to setting the 'activation date' and 'expiration date', the key must be rotated manually.

Using customer-managed keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

### Using Azure Portal

1. Login to Azure Portal using https://portal.azure.com
2. Navigate to `Batch accounts`

For each Batch account perform the following:

1. Under the `Settings` section, click on `Encryption`
2. Ensure that the `Customer-managed key` radio button is selected
3. Ensure that a key vault key is set and valid

If no key vault key is set, the configuration fails this audit procedure.

### Using Azure CLI

The following command should return the Key URL and source Key Vault:

```bash
az batch account show --name <batch-account-name> --resource-group <resource-group-name> --query "keyVaultReference"
```

If the result is `null` or `Empty`, the configuration fails this audit procedure.

### Using Azure PowerShell

```powershell
Set-AzBatchAccount -ResourceGroupName <resource_group_name> -AccountName <batch_account_name> `
  -KeyVaultReferenceId "/subscriptions/<subscription_ID>/resourceGroups/<resource_group_name>/providers/Microsoft.KeyVault/vaults/<keyvault_name>" `
  -KeyVaultReferenceUrl "https://<keyvault_name>.vault.azure.net/keys/<key_name>"
```

## Expected Result

The Batch account should have `Customer-managed key` encryption selected with a valid key vault key configured. The `keyVaultReference` should not be `null` or empty.

## Remediation

### Using Azure Portal

1. Login to Azure Portal using https://portal.azure.com
2. Navigate to `Batch accounts`

For each Batch account:

1. Under the `Settings` section, click on `Encryption`
2. Select the `Customer-managed key` radio button
3. Use either `Enter key URI` or `Select from key vault` to select and set the encryption key.

### Using Azure CLI

```bash
# Link CMK to Batch account
az batch account set \
  --resource-group <resource_group_name> \
  --name <batch_account_name> \
  --encryption-key-identifier https://<keyvault_name>.vault.azure.net/keys/<key_name>/<Version>
```

### Using Azure PowerShell

```powershell
Set-AzBatchAccount -ResourceGroupName <resource_group_name> -AccountName <batch_account_name> `
  -KeyVaultReferenceId "/subscriptions/<subscription_ID>/resourceGroups/<resource_group_name>/providers/Microsoft.KeyVault/vaults/<keyvault_name>" `
  -KeyVaultReferenceUrl "https://<keyvault_name>.vault.azure.net/keys/<key_name>"
```

## Default Value

Azure Batch accounts uses Microsoft-managed keys (service-managed encryption) for data at rest by default.

## References

1. https://learn.microsoft.com/en-us/azure/batch/batch-customer-managed-key

## Profile

Level 2 | Manual
