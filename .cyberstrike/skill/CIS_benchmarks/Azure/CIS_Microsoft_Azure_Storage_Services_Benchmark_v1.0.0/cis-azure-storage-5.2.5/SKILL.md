---
name: cis-azure-storage-5.2.5
description: "Ensure public network access on Recovery Services vaults is Disabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, network-security, public-access, private-endpoint, rbac]
cis_id: "5.2.5"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.5 Ensure public network access on Recovery Services vaults is Disabled (Automated)

## Description

Disable public network access on Recovery Services vaults to prevent exposure to the internet and reduce the risk of unauthorized access. Use private endpoints and Azure Role-Based Access Control (RBAC) to securely manage access within trusted networks.

## Rationale

Disabling public network access improves security by ensuring that a Recovery Services vault is not exposed on the public internet.

## Impact

Disabling public network access on Recovery Services vaults restricts access to the vault. This enhances security but may require the configuration of private endpoints for any services or users needing access within trusted networks.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services` vaults.
2. Click the name of a vault.
3. Under `Settings`, click `Networking`.
4. Under `Public access`, ensure that `Public network access` is set to `Deny`.
5. Repeat steps 1-4 for each Recovery Services vault.

### Audit from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault, run the following command:

```bash
az backup vault show --resource-group <resource-group> --name <recovery-services-vault>
```

Ensure that under `properties`, `publicNetworkAccess` is set to `Disabled`.

### Audit from PowerShell

Run the following command to list Recovery Services vaults:

```powershell
Get-AzRecoveryServicesVault
```

Run the following command to get the vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to get the public network access setting for the vault:

```powershell
$vault.Properties.PublicNetworkAccess
```

Ensure that the command returns `Disabled`.
Repeat for each Recovery Services vault.

## Expected Result

- `properties.publicNetworkAccess` is set to `Disabled`
- In Azure Portal, `Public network access` is set to `Deny`
- PowerShell returns `Disabled` for `$vault.Properties.PublicNetworkAccess`

## Remediation

### Remediate from Azure Portal

1. Go to `Recovery Services` vaults.
2. Click the name of a vault.
3. Under `Settings`, click `Networking`.
4. Under `Public access`, click the radio button next to `Deny`.
5. Click `Apply`.
6. Repeat steps 1-5 for each Recovery Services vault requiring remediation.

### Remediate from Azure CLI

For each Recovery Services vault requiring remediation, run the following command to disable public network access:

```bash
az backup vault update --resource-group <resource-group> --name <recovery-services-vault> --public-network-access Disable
```

### Remediate from PowerShell

For each Recovery Services vault requiring remediation, run the following command to disable public network access:

```powershell
Update-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault> -PublicNetworkAccess "Disabled"
```

## Default Value

Public network access is enabled by default on Recovery Services vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/private-endpoints#deny-public-network-access-to-the-vault
2. https://learn.microsoft.com/en-us/cli/azure/backup/vault?view=azure-cli-latest#az-backup-vault-list
3. https://learn.microsoft.com/en-us/cli/azure/backup/vault?view=azure-cli-latest#az-backup-vault-show
4. https://learn.microsoft.com/en-us/cli/azure/backup/vault?view=azure-cli-latest#az-backup-vault-update
5. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/get-azrecoveryservicesvault?view=azps-12.4.0
6. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/update-azrecoveryservicesvault?view=azps-12.4.0

### Additional Information

Private endpoints for Backup can be only created for Recovery Services vaults that don't have any items protected to it. Azure recommends creating a new vault, and outlines a recommended workflow for disabling public network access and creating private endpoints in the following guides:

- Create and use private endpoints (v1 experience) for Azure Backup
- Create and use private endpoints (v2 experience) for Azure Backup

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | X | X | X |

## Profile

Level 1 | Automated
