---
name: cis-azure-compute-2.5
description: "Ensure Azure Key Vaults are Used to Store Secrets"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, key-vault, secrets]
cis_id: "2.5"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Azure Key Vaults are Used to Store Secrets

## Description
Azure Key Vault will store multiple types of sensitive information such as encryption keys, certificate thumbprints, and Managed Identity Credentials. Access to these 'Secrets' can be controlled through granular permissions.

## Rationale
The credentials given to an application have permissions to create, delete, or modify data stored within the systems they access. If these credentials are stored within the application itself, anyone with access to the application or a copy of the code has access to them. Storing within Azure Key Vault as secrets increases security by controlling access. This also allows for updates of the credentials without redeploying the entire application.

## Impact
Integrating references to secrets within the key vault are required to be specifically integrated within the application code. This will require additional configuration to be made during the writing of an application, or refactoring of an already written one. There are also additional costs that are charged per 10000 requests to the Key Vault.

## Audit Procedure

### Using Azure Portal
1. Login to Azure Portal.
2. In the expandable menu on the left go to `Key Vaults`.
3. View the Key Vaults listed.

### Using Azure CLI
To list key vaults and/or HSMs within a subscription run the following command:
```bash
az keyvault list [--resource-type] --subscription <id_or_name_of_target_subscription>
```
`--resource-type` could be either `__vault__` or `__hsm__`. When parameter is missing all types of vaults will be listed.

To list the secrets within a target key vault run the following command:
```bash
az keyvault secret list [--vault-name / --id]
```

To list the certificates within a target key vault run the following command:
```bash
az keyvault certificate list [--vault-name / --id]
```

To list the keys within a target key vault run the following command:
```bash
az keyvault secret list [--vault-name / --id]
```
`--id` represents the full URI of the vault. `--vault-name` represents the name and must be present if `--id` is missing.

### Using Azure PowerShell
To list key vaults within a subscription run the following command:
```powershell
Get-AzKeyVault
```

To list all secrets in a key vault run the following command:
```powershell
Get-AzKeyVaultSecret -VaultName '<vaultName>'
```

## Expected Result
Azure Key Vaults should be created and secrets should be stored within them rather than in application code or configuration files.

## Remediation
Remediation has 2 steps:
1. Set up the Key Vault
2. Set up the App Service to use the Key Vault

### Step 1: Set up the Key Vault

#### Using Azure CLI
```bash
az keyvault create --name "<name>" --resource-group "<myResourceGroup>" --location myLocation
```

#### Using Azure PowerShell
```powershell
New-AzKeyvault -name <name> -ResourceGroupName <myResourceGroup> -Location <myLocation>
```

### Step 2: Set up the App Service to use the Key Vault
Configure the App Service to reference secrets from Key Vault using Key Vault references in application settings. Use a system-assigned managed identity with appropriate access policies granting "get" permission on secrets.

## Default Value
By default, no Azure Key Vaults are created.

## References
1. https://docs.microsoft.com/en-us/azure/app-service/app-service-key-vault-references
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-3-manage-application-identities-securely-and-automatically
3. https://docs.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest
4. https://docs.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest

## Profile
Level 2 | Manual
