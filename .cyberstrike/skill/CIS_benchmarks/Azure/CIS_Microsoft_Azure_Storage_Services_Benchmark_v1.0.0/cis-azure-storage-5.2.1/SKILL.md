---
name: cis-azure-storage-5.2.1
description: "Ensure soft delete on Recovery Services vaults is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, soft-delete, data-protection, retention]
cis_id: "5.2.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.1 Ensure soft delete on Recovery Services vaults is Enabled (Automated)

## Description

Soft delete provides additional protection for Recovery Services vault data. With soft delete enabled, deleted backup data can be recovered within the retention period.

## Rationale

Important backup data could be accidentally deleted or removed by a malicious actor. With soft delete enabled, data is retained for at least 14 days before permanent deletion, allowing for the recovery of the backup data.

## Impact

There is no additional cost for backup data in the soft delete state for up to and including 14 days. However, retention beyond 14 days may incur additional charges.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Soft Delete and security settings`, click `Update`.
5. Ensure the box next to `Enable soft delete for cloud workloads` is checked.
6. Ensure the box next to `Enable soft delete and security settings for hybrid workloads` is checked.
7. Ensure that the `Soft delete retention period` is set to an appropriate value between 14 and 180, inclusive.
8. Repeat steps 1-7 for each Recovery Services vault.

### Audit from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault, run the following command:

```bash
az backup vault show --resource-group <resource-group> --name <recovery-services-vault>
```

Ensure that under `softDeleteSettings`, `softDeleteState` is set to `Enabled`, `enhancedSecurityState` is set to `Enabled`, and `softDeleteRetentionPeriodInDays` is set to an appropriate value between 14 and 180, inclusive.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `31b8092a-36b8-434b-9af7-5ec844364148`
- Name: '[Preview]: Soft delete must be enabled for Recovery Services Vaults.'

## Expected Result

- `softDeleteSettings.softDeleteState` is set to `Enabled`
- `enhancedSecurityState` is set to `Enabled`
- `softDeleteRetentionPeriodInDays` is between 14 and 180, inclusive
- In Azure Portal, both `Enable soft delete for cloud workloads` and `Enable soft delete and security settings for hybrid workloads` boxes are checked

## Remediation

### Remediate from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Soft Delete and security settings`, click `Update`.
5. Check the box next to `Enable soft delete for cloud workloads`.
6. Check the box next to `Enable soft delete and security settings for hybrid workloads`.
7. In the box next to `Soft delete retention period`, set an appropriate number of days for deleted data to be retained, between 14 and 180, inclusive.
8. If it is appropriate for your organization, check the box next to `Enable always-on soft delete`. Note: Once enabled, this setting cannot be disabled.
9. If enabling always-on soft delete, check the box next to `Confirm enabling always-on soft delete`.
10. Click `Update`.
11. Repeat steps 1-10 for each Recovery Services vault requiring remediation.

### Remediate from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault requiring remediation, run the following command to enable soft delete and set an appropriate number of days for deleted data to be retained, between 14 and 180, inclusive:

```bash
az backup vault backup-properties set --resource-group <resource-group> --name <recovery-services-vault> --soft-delete-feature-state Enable --hybrid-backup-security-features Enable --soft-delete-duration <retention-duration>
```

Note: To enable always-on soft delete, the above command can be executed with `--soft-delete-feature-state AlwaysOn`. Once enabled, this setting cannot be disabled.

## Default Value

Soft delete is enabled by default on newly created Recovery Services vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/backup-azure-recovery-services-vault-overview
2. https://learn.microsoft.com/en-us/azure/backup/backup-azure-security-feature-cloud
3. https://learn.microsoft.com/en-us/azure/backup/backup-azure-enhanced-soft-delete-about
4. https://learn.microsoft.com/en-us/azure/backup/soft-delete-virtual-machines
5. https://learn.microsoft.com/en-us/azure/backup/soft-delete-sql-saphana-in-azure-vm
6. https://learn.microsoft.com/en-us/cli/azure/backup/vault

### Additional Information

Azure Backup soft delete protection is available for the following services:

- Azure virtual machines
- SQL server in Azure VM and SAP HANA in Azure VM workloads

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11.1 Establish and Maintain a Data Recovery Process - Establish and maintain a data recovery process. In the process, address the scope of data recovery activities, recovery prioritization, and the security of backup data. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | X | X | X |
| v7 | 10.4 Ensure Protection of Backups - Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services. | X | X | X |

## Profile

Level 1 | Automated
