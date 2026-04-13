---
name: cis-azure-storage-5.2.6
description: "Ensure 'Cross Region Restore' is set to 'Enabled' on Recovery Services vaults"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, cross-region-restore, disaster-recovery, geo-redundancy, resilience]
cis_id: "5.2.6"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.6 Ensure 'Cross Region Restore' is set to 'Enabled' on Recovery Services vaults (Automated)

## Description

Cross region restore enables data restoration in a secondary Azure paired region, even when the primary region is fully operational. This allows organizations to conduct drills and validate regional resiliency, thereby ensuring preparedness for potential outages.

## Rationale

Enabling cross region restore facilitates proactive resilience testing and disaster recovery planning by allowing data restoration drills in a secondary region without needing a primary region outage. This capability helps organizations validate recovery processes, identify gaps in regional failover, and ensures critical data can be accessed and restored during real disruptions.

## Impact

Enabling cross region restore on a Recovery Services vault incurs additional costs, and once it is enabled, it cannot be disabled.

- Cross region restore can only be enabled on Recovery Services vaults using the GRS replication type.
- Cross region restore is available for Azure Virtual Machines, SQL/SAP HANA databases running inside Azure VMs, and Recovery Services Agent (Preview) in the vault. There is no support for classic VMs.
- Cross region restore is currently an irreversible storage property.
- When cross region restore is enabled, Azure upgrades backup storage from GRS to read-access geo-redundant storage (RA-GRS). Pricing is updated accordingly.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Backup Configuration`, click `Update`.
5. Next to `Cross Region Restore`, ensure the radio button next to `Enabled` is selected.
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

Ensure that under `properties` > `redundancySettings`, `crossRegionRestore` is set to `Enabled`.

### Audit from PowerShell

Run the following command to list Recovery Services vaults:

```powershell
Get-AzRecoveryServicesVault
```

Run the following command to get the Recovery Services vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to get the cross region restore setting for the Recovery Services vault:

```powershell
$vault.Properties.RedundancySettings.CrossRegionRestore
```

Ensure that the command returns `Enabled`.
Repeat for each Recovery Services vault.

## Expected Result

- `properties.redundancySettings.crossRegionRestore` is set to `Enabled`
- In Azure Portal, the radio button next to `Enabled` is selected for `Cross Region Restore`
- PowerShell returns `Enabled` for `$vault.Properties.RedundancySettings.CrossRegionRestore`

## Remediation

### Remediate from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Backup Configuration`, click `Update`.
5. Next to `Cross Region Restore`, select the radio button next to `Enabled`.
6. Click `Apply`.
7. Repeat steps 1-6 for each Recovery Services vault requiring remediation.

### Remediate from Azure CLI

For each Recovery Services vault requiring remediation, run the following command to enable cross region restore:

```bash
az backup vault update --resource-group <resource-group> --name <recovery-services-vault> --cross-region-restore-flag Enabled
```

### Remediate from PowerShell

Run the following command to get the Recovery Services vault in a resource group with a given name:

```powershell
$vault = Get-AzRecoveryServicesVault -ResourceGroupName <resource-group> -Name <recovery-services-vault>
```

Run the following command to enable cross region restore:

```powershell
Set-AzRecoveryServicesBackupProperty -Vault $vault -EnableCrossRegionRestore
```

Repeat for each Recovery Services vault requiring remediation.

## Default Value

Cross region restore is disabled by default on Recovery Services vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault#set-cross-region-restore
2. https://learn.microsoft.com/en-us/cli/azure/backup/vault
3. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/get-azrecoveryservicesvault
4. https://learn.microsoft.com/en-us/powershell/module/az.recoveryservices/set-azrecoveryservicesbackupproperty

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11.1 Establish and Maintain a Data Recovery Process - Establish and maintain a data recovery process. In the process, address the scope of data recovery activities, recovery prioritization, and the security of backup data. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | X | X | X |
| v7 | 10.4 Ensure Protection of Backups - Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services. | X | X | X |

## Profile

Level 2 | Automated
