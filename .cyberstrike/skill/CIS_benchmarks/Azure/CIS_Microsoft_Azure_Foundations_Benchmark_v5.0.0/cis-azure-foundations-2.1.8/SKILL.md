---
name: cis-azure-foundations-2.1.8
description: "Ensure critical data in Azure Databricks is encrypted with customer-managed keys (CMK)"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, databricks, analytics]
cis_id: "2.1.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-2.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure critical data in Azure Databricks is encrypted with customer-managed keys (CMK)

## Description

Customer-managed keys introduce additional depth to security by providing a means to manage access control for encryption keys. Where compliance and security frameworks indicate the need, and organizational capacity allows, sensitive data at rest can be encrypted using customer-managed keys (CMK) rather than Microsoft-managed keys.

## Rationale

By default in Azure, data at rest tends to be encrypted using Microsoft-managed keys. If your organization wants to control and manage encryption keys for compliance and defense-in-depth, customer-managed keys can be established.

While it is possible to automate the assessment of this recommendation, the assessment status for this recommendation remains 'Manual' due to ideally limited scope. The scope of application -- which workloads CMK is applied to -- should be carefully considered to account for organizational capacity and targeted to workloads with specific need for CMK.

## Impact

If the key expires due to setting the 'activation date' and 'expiration date', the key must be rotated manually.

Using customer-managed keys may also incur additional man-hour requirements to create, store, manage, and protect the keys as needed.

## Audit Procedure

### Audit from Azure Portal

1. Go to Azure Portal -> Databricks Workspaces.
2. Select a Databricks Workspace and go to Encryption settings.
3. Check if customer-managed keys (CMK) are enabled under "Managed Disk Encryption".
4. If CMK is not enabled, the workspace is non-compliant.

### Audit from Azure CLI

Run the following command to check encryption settings for Databricks workspace:

```bash
az databricks workspace show --name <databricks-workspace-name> --resource-group <resource-group-name> --query encryption
```

Ensure that keySource is set to `Microsoft.KeyVault`.

### Audit from PowerShell

```powershell
Get-AzDatabricksWorkspace -ResourceGroupName "<resource-group-name>" -Name "<databricks-workspace-name>" | Select-Object Encryption
```

Verify that encryption is set to `Customer-Managed Keys (CMK)`.

### Audit from Databricks CLI

```bash
databricks workspace get-metadata --workspace-id <workspace-id>
```

Ensure that encryption settings reflect a CMK setup.

## Expected Result

The workspace encryption settings should show `Microsoft.KeyVault` as the keySource, indicating customer-managed keys are in use. The encryption type should be CMK, not Microsoft-managed keys.

## Remediation

**NOTE:** These remediations assume that an Azure KeyVault already exists in the subscription.

### Remediate from Azure CLI

1. Create a dedicated key:

```bash
az keyvault key create --vault-name <keyvault-name> --name <key-name> --protection <"software" or "hsm">
```

2. Assign permissions to Databricks:

```bash
az keyvault set-policy --name <keyvault-name> --resource-group <resource-group-name> --spn <databricks-spn> --key-permissions get wrapKey unwrapKey
```

3. Enable encryption with CMK:

```bash
az databricks workspace update --name <databricks-workspace-name> --resource-group <resource-group-name> --key-source "Microsoft.KeyVault" --key-name <key-name> --keyvault-uri <keyvault-uri>
```

### Remediate from PowerShell

```powershell
$Key = Add-AzKeyVaultKey -VaultName <keyvault-name> -Name <key-name> -Destination <"software" or "hsm">
Set-AzDatabricksWorkspace -ResourceGroupName "<resource-group-name>" -WorkspaceName "<databricks-workspace-name>" -EncryptionKeySource "Microsoft.KeyVault" -KeyVaultUri $Key.Id
```

## Default Value

By default, encryption type is set to Microsoft-managed keys.

## References

1. https://learn.microsoft.com/en-us/azure/security/fundamentals/data-encryption-best-practices#protect-data-at-rest
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-5-use-customer-managed-key-option-in-data-at-rest-encryption-when-required
3. https://learn.microsoft.com/en-us/azure/databricks/security/keys/cmk-managed-disks-azure/cmk-managed-disks-azure

## Additional Information

This recommendation is based on the Common Reference Recommendation `Ensure critical data is encrypted with customer-managed keys (CMK)`, from the Common Reference Recommendations > Secrets and Keys > Encryption Key Management > Customer Managed Keys section.

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest                              |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest                       |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| ---------------------------- | ------- | ----------- |
| T1530                        | TA0009  | M1041       |

## Profile

Level 2 | Manual
