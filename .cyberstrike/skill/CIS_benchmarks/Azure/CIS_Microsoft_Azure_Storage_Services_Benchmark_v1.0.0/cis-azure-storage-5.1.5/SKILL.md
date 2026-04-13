---
name: cis-azure-storage-5.1.5
description: "Ensure 'Cross Region Restore' is set to 'Enabled' on Backup vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, cross-region-restore, disaster-recovery]
cis_id: "5.1.5"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.5 Ensure 'Cross Region Restore' is set to 'Enabled' on Backup vaults (Automated)

## Description

Cross region restore enables data restoration in a secondary Azure paired region, even when the primary region is fully operational. This allows organizations to conduct drills and validate regional resiliency, thereby ensuring preparedness for potential outages.

## Rationale

Enabling cross region restore facilitates proactive resilience testing and disaster recovery planning by allowing data restoration drills in a secondary region without needing a primary region outage. This capability helps organizations validate recovery processes, identify gaps in regional failover, and ensures critical data can be accessed and restored during real disruptions.

## Impact

Enabling cross region restore on a Backup vault incurs additional costs, and once it is enabled, it cannot be disabled.

- Cross region restore is an irreversible storage property.
- Cross region restore is currently supported for limited workloads.
- Cross region restore can only be enabled if the redundancy of the vault is GRS.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under `Vault Settings`, ensure that `Cross Region Restore` is set to `Enabled`.
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

Ensure that under `properties` > `featureSettings` > `crossRegionRestoreSettings`, `state` is set to `Enabled`.

### Audit from PowerShell

Run the following command to list Backup vaults:

```powershell
Get-AzDataProtectionBackupVault
```

Run the following command to get the Backup vault in a resource group with a given name:

```powershell
$vault = Get-AzDataProtectionBackupVault -ResourceGroupName <resource-group> -VaultName <backup-vault>
```

Run the following command to get the cross region restore setting for the Backup vault:

```powershell
$vault.CrossRegionRestoreState
```

Ensure that the command returns `Enabled`.
Repeat for each Backup vault.

## Expected Result

`Cross Region Restore` should be `Enabled` in the Azure Portal, or `properties.featureSettings.crossRegionRestoreSettings.state` should be `Enabled` in CLI output, or `$vault.CrossRegionRestoreState` should return `Enabled` in PowerShell.

## Remediation

### Remediate from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under `Vault Settings`, next to `Cross Region Restore`, click `Update`.
5. Click the toggle switch under `Cross Region Restore` to set it to `Enable`.
6. Click `Apply`.
7. Repeat steps 1-6 for each Backup vault requiring remediation.

### Remediate from Azure CLI

For each Backup vault requiring remediation, run the following command to enable cross region restore:

```bash
az dataprotection backup-vault update --resource-group <resource-group> --vault-name <backup-vault> --cross-region-restore-state Enabled
```

### Remediate from PowerShell

For each Backup vault requiring remediation, run the following command to enable cross region restore:

```powershell
Update-AzDataProtectionBackupVault -ResourceGroupName <resource-group> -VaultName <backup-vault> -CrossRegionRestoreState Enabled
```

## Default Value

Cross region restore is disabled by default on Backup vaults.

## References

1. https://learn.microsoft.com/en-gb/azure/backup/backup-vault-overview#cross-region-restore-support-for-postgresql-using-azure-backup
2. https://learn.microsoft.com/en-us/azure/backup/tutorial-cross-region-restore
3. https://azure.microsoft.com/en-gb/pricing/details/backup/
4. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault
5. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/get-azdataprotectionbackupvault
6. https://learn.microsoft.com/en-us/powershell/module/az.dataprotection/update-azdataprotectionbackupvault

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11.1 Establish and Maintain a Data Recovery Process | X | X | X |
| v7 | 10.4 Ensure Protection of Backups | X | X | X |

## Profile

Level 2 | Automated
