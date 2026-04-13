---
name: cis-azure-foundations-6.1.1.3
description: "Ensure storage account containing activity logs is encrypted with CMK"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, logging, monitoring, encryption, cmk, storage]
cis_id: "6.1.1.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-6.1.1.1]
prerequisites: [cis-azure-foundations-6.1.1.1]
severity_boost: {}
---

# Ensure the storage account containing the container with activity logs is encrypted with customer-managed key (CMK)

## Description

Customer-managed keys introduce additional depth to security by providing a means to manage access control for encryption keys. Where compliance and security frameworks indicate the need, and organizational capacity allows, sensitive data at rest can be encrypted using customer-managed keys (CMK) rather than Microsoft-managed keys.

## Rationale

By default in Azure, data at rest tends to be encrypted using Microsoft-managed keys. If your organization wants to control and manage encryption keys for compliance and defense-in-depth, customer-managed keys can be established.

Configuring the storage account with the activity log export container to use CMKs provides additional confidentiality controls on log data, as a given user must have read permission on the corresponding storage account and must be granted decrypt permission by the CMK.

## Impact

If the key expires due to setting the 'activation date' and 'expiration date', the key must be rotated manually. Using customer-managed keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

### Using Azure Portal

1. Go to `Monitor`.
2. Select `Activity log`.
3. Select `Export Activity Logs`.
4. Select a `Subscription`.
5. Note the name of the `Storage Account` for the diagnostic setting.
6. Navigate to `Storage accounts`.
7. Click on the storage account name noted in Step 5.
8. Under `Security + networking`, click `Encryption`.
9. Ensure `Customer-managed keys` is selected and a key is set.

### Using Azure CLI

1. Get storage account id configured with log profile:

```bash
az monitor diagnostic-settings subscription list --subscription <subscription id> --query 'value[*].storageAccountId'
```

2. Ensure the storage account is encrypted with CMK:

```bash
az storage account list --query "[?name=='<Storage Account Name>']"
```

In command output ensure `keySource` is set to `Microsoft.Keyvault` and `keyVaultProperties` is not set to `null`.

### Using PowerShell

```powershell
Get-AzStorageAccount -ResourceGroupName <resource group name> -Name <storage account name>|select-object -ExpandProperty encryption|format-list
```

Ensure the value of `KeyVaultProperties` is not `null` or empty, and ensure `KeySource` is not set to `Microsoft.Storage`.

## Expected Result

The storage account containing activity logs should use Customer-managed keys (CMK) for encryption, with `keySource` set to `Microsoft.Keyvault`.

## Remediation

### Remediate from Azure Portal

1. Go to `Monitor`.
2. Select `Activity log`.
3. Select `Export Activity Logs`.
4. Select a `Subscription`.
5. Note the name of the `Storage Account` for the diagnostic setting.
6. Navigate to `Storage accounts`.
7. Click on the storage account.
8. Under `Security + networking`, click `Encryption`.
9. Next to `Encryption type`, select `Customer-managed keys`.
10. Complete the steps to configure a customer-managed key for encryption of the storage account.

### Remediate from Azure CLI

```bash
az storage account update --name <name of the storage account> --resource-group <resource group for a storage account> --encryption-key-source=Microsoft.Keyvault --encryption-key-vault <Key Vault URI> --encryption-key-name <KeyName> --encryption-key-version <Key Version>
```

### Remediate from PowerShell

```powershell
Set-AzStorageAccount -ResourceGroupName <resource group name> -Name <storage account name> -KeyvaultEncryption -KeyVaultUri <key vault URI> -KeyName <key name>
```

## Default Value

By default, encryption type is set to Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/security/fundamentals/data-encryption-best-practices#protect-data-at-rest
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required
3. https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/activity-log?tabs=cli#managing-legacy-log-profiles

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## MITRE ATT&CK Mappings

| Techniques | Tactics | Mitigations |
| ---------- | ------- | ----------- |
| T1530 | TA0009 | M1041 |

## Profile

Level 2 | Manual
