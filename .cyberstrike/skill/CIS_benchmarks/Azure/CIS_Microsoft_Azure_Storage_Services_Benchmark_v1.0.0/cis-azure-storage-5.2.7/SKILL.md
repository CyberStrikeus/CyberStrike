---
name: cis-azure-storage-5.2.7
description: "Ensure 'Cross Subscription Restore' is set to 'Disabled' or 'Permanently Disabled' on Recovery Services vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, cross-subscription-restore, access-control, data-exfiltration]
cis_id: "5.2.7"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.7 Ensure 'Cross Subscription Restore' is set to 'Disabled' or 'Permanently Disabled' on Recovery Services vaults (Automated)

## Description

Disable cross subscription restore for Recovery Services vaults to ensure that backup data can only be restored within the same subscription as the Recovery Services vault, preventing restoration to targets in other subscriptions.

## Rationale

Cross subscription restores increases security risks by widening access to sensitive backup data, potentially leading to accidental or intentional exposure, unauthorized access, or data exfiltration across environments.

## Impact

Organizations may need to consider alternatives for disaster recovery scenarios, and if utilizing multiple subscriptions, may need to make adjustments or consider alternatives for data access. Costs could be incurred if alternative or additional backup infrastructure is required to account for the disabling of cross subscription restore.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Cross Subscription Restore`, click `Update`.
5. Ensure that `Disable Cross Subscription Restore` or `Permanently disable Cross Subscription Restore on this vault` is selected.
6. Repeat steps 1-5 for each Recovery Services vault.

### Audit from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault, run the following command:

```bash
az backup vault show --resource-group <resource-group> --name <recovery-services-vault>
```

Ensure that under `properties` > `restoreSettings` > `crossSubscriptionRestoreSettings`, `crossSubscriptionRestoreState` is set to `Disabled` or `PermanentlyDisabled`.

### Audit from PowerShell

Run the following command to list Recovery Services vaults:

```powershell
Get-AzRecoveryServicesVault
```

Run the following command to get the Recovery Services vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to get the cross subscription restore setting for the Recovery Services vault:

```powershell
$vault.Properties.RestoreSettings.CrossSubscriptionRestoreSettings.CrossSubscriptionRestoreState
```

Ensure that the command returns `Disabled` or `PermanentlyDisabled`.
Repeat for each Recovery Services vault.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `f19b0c83-716f-4b81-85e3-2dbf057c35d6`
- Name: '[Preview]: Disable Cross Subscription Restore for Azure Recovery Services vaults'

## Expected Result

- `properties.restoreSettings.crossSubscriptionRestoreSettings.crossSubscriptionRestoreState` is set to `Disabled` or `PermanentlyDisabled`
- In Azure Portal, `Disable Cross Subscription Restore` or `Permanently disable Cross Subscription Restore on this vault` is selected
- PowerShell returns `Disabled` or `PermanentlyDisabled`

## Remediation

### Remediate from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Cross Subscription Restore`, click `Update`.
5. Select the radio button next to `Disable Cross Subscription Restore` or `Permanently disable Cross Subscription Restore on this vault`.
6. If selecting to permanently disable cross subscription restore, check the box next to `Are you sure you want to permanently disable Cross Subscription Restore? Once disabled, it cannot be re-enabled.`
7. Click Update.
8. Repeat steps 1-7 for each Recovery Services vault requiring remediation.

### Remediate from Azure CLI

For each Recovery Services vault requiring remediation, run the following command to disable cross subscription restore:

```bash
az backup vault update --resource-group <resource-group> --name <recovery-services-vault> --cross-subscription-restore-state Disable
```

Note: Use `--cross-subscription-restore-state PermanentlyDisable` with the above command to permanently disable cross subscription restore.

### Remediate from PowerShell

For each Recovery Services vault requiring remediation, run the following command to disable cross subscription restore:

```powershell
Update-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault> -CrossSubscriptionRestoreState Disabled
```

Note: Use `-CrossSubscriptionRestoreState PermanentlyDisabled` with the above command to permanently disable cross subscription restore.

## Default Value

Cross subscription restore is enabled by default on Recovery Services vaults.

## References

1. https://learn.microsoft.com/en-us/cli/azure/backup/vault
2. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/get-azrecoveryservicesvault
3. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/update-azrecoveryservicesvault
4. https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#cross-subscription-restore-for-azure-vm

### Additional Information

If cross subscription restore is permanently disabled on a vault, it cannot be re-enabled.

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | X | X | X |

## Profile

Level 1 | Automated
