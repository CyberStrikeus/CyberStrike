---
name: cis-azure-storage-5.1.6
description: "Ensure 'Cross Subscription Restore' is set to 'Disabled' or 'Permanently Disabled' on Backup vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, cross-subscription-restore, access-control]
cis_id: "5.1.6"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.6 Ensure 'Cross Subscription Restore' is set to 'Disabled' or 'Permanently Disabled' on Backup vaults (Automated)

## Description

Disable cross subscription restore for Backup vaults to ensure that backup data can only be restored within the same subscription as the Backup vault, preventing restoration to targets in other subscriptions.

## Rationale

Cross subscription restores increases security risks by widening access to sensitive backup data, potentially leading to accidental or intentional exposure, unauthorized access, or data exfiltration across environments.

## Impact

Organizations may need to consider alternatives for disaster recovery scenarios, and if utilizing multiple subscriptions, may need to make adjustments or consider alternatives for data access. Costs could be incurred if alternative or additional backup infrastructure is required to account for the disabling of cross subscription restore.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under `Vault Settings`, ensure that `Cross Subscription Restore` is set to `Disabled` or `Permanently Disabled`.
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

Ensure that under `properties` > `featureSettings` > `crossSubscriptionRestoreSettings`, `state` is set to `Disabled` or `PermanentlyDisabled`.

### Audit from PowerShell

Run the following command to list Backup vaults:

```powershell
Get-AzDataProtectionBackupVault
```

Run the following command to get the Backup vault in a resource group with a given name:

```powershell
$vault = Get-AzDataProtectionBackupVault -ResourceGroupName <resource-group> -VaultName <backup-vault>
```

Run the following command to get the cross subscription restore setting for the Backup vault:

```powershell
$vault.CrossSubscriptionRestoreState
```

Ensure that the command returns `Disabled` or `PermanentlyDisabled`.
Repeat for each Backup vault.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `4d479a11-f2b5-4f0a-bb1e-d2332aa95cda`
- Name: '[Preview]: Disable Cross Subscription Restore for Backup Vaults'

## Expected Result

`Cross Subscription Restore` should be `Disabled` or `Permanently Disabled` in the Azure Portal, or `properties.featureSettings.crossSubscriptionRestoreSettings.state` should be `Disabled` or `PermanentlyDisabled` in CLI output, or `$vault.CrossSubscriptionRestoreState` should return `Disabled` or `PermanentlyDisabled` in PowerShell.

## Remediation

### Remediate from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under Vault Settings, next to Cross Subscription Restore, click Update.
5. Select the radio button next to `Disable Cross Subscription Restore` or `Permanently disable Cross Subscription Restore on this vault`.
6. If selecting to permanently disable cross subscription restore, check the box next to `Are you sure you want to permanently disable Cross Subscription Restore? Once disabled, it cannot be re-enabled.`
7. Click `Update`.
8. Repeat steps 1-7 for each Backup vault requiring remediation.

### Remediate from Azure CLI

For each Backup vault requiring remediation, run the following command to disable cross subscription restore:

```bash
az dataprotection backup-vault update --resource-group <resource-group> --vault-name <backup-vault> --cross-subscription-restore-state Disabled
```

Note: Use `--cross-subscription-restore-state PermanentlyDisabled` with the above command to permanently disable cross subscription restore.

### Remediate from PowerShell

For each Backup vault requiring remediation, run the following command to disable cross subscription restore:

```powershell
Update-AzDataProtectionBackupVault -ResourceGroupName <resource-group> -VaultName <backup-vault> -CrossSubscriptionRestoreState Disabled
```

Note: Use `-CrossSubscriptionRestoreState PermanentlyDisabled` with the above command to permanently disable cross subscription restore.

## Default Value

Cross subscription restore is enabled by default on Backup vaults.

## References

1. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault
2. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/get-azdataprotectionbackupvault
3. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/update-azdataprotectionbackupvault
4. https://learn.microsoft.com/en-us/azure/backup/create-manage-backup-vault#cross-subscription-restore-using-azure-portal

## Additional Information

If cross subscription restore is permanently disabled on a vault, it cannot be re-enabled.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

## Profile

Level 1 | Automated
