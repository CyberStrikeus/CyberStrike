---
name: cis-azure-storage-5.1.1
description: "Ensure soft delete on Backup vaults is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, soft-delete]
cis_id: "5.1.1"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1 Ensure soft delete on Backup vaults is Enabled (Automated)

## Description

Soft delete provides additional protection for Backup vault data. With soft delete enabled, deleted backup data can be recovered within the retention period.

## Rationale

Important backup data could be accidentally deleted or removed by a malicious actor. With soft delete enabled, data is retained for at least 14 days before permanent deletion, allowing for the recovery of the backup data.

## Impact

There is no additional cost for backup data in the soft delete state for up to and including 14 days. However, retention beyond 14 days may incur additional charges.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Ensure `Soft delete` is set to `Enabled` or `Enabled with Always-On`.
5. Next to `Soft delete`, click `Update`.
6. Ensure that the `Retention period` is set to an appropriate value between 14 and 180, inclusive.
7. Repeat steps 1-6 for each Backup vault.

### Audit from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault, run the following command:

```bash
az dataprotection backup-vault show --resource-group <resource-group> --vault-name <backup-vault>
```

Ensure that under `softDeleteSettings`, `state` is set to `on` or `alwayson`, and `retentionDurationInDays` is set to an appropriate value between 14 and 180, inclusive.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `9798d31d-6028-4dee-8643-46102185c016`
- Name: '[Preview]: Soft delete should be enabled for Backup Vaults'

## Expected Result

`softDeleteSettings.state` should be `on` or `alwayson`, and `retentionDurationInDays` should be between 14 and 180, inclusive.

## Remediation

### Remediate from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Next to `Soft delete`, click `Update`.
5. Check the box next to `Soft delete`.
6. In the box next to `Retention period`, set an appropriate number of days for deleted data to be retained, between 14 and 180, inclusive.
7. If it is appropriate for your organization, check the box next to `Enable always-on soft delete`. Note: Once enabled, this setting cannot be disabled.
8. Click `Update`.
9. Repeat steps 1-8 for each Backup vault requiring remediation.

### Remediate from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault requiring remediation, run the following command to enable soft delete and set an appropriate number of days for deleted data to be retained, between 14 and 180, inclusive:

```bash
az dataprotection backup-vault update --resource-group <resource-group> --vault-name <backup-vault> --soft-delete-state On --retention-duration-in-days <retention-duration>
```

Note: To enable always-on soft delete, the above command can be executed with `--soft-delete-state AlwaysOn`. Once enabled, this setting cannot be disabled.

## Default Value

Soft delete is enabled by default on newly created Backup vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/backup-vault-overview
2. https://learn.microsoft.com/en-us/azure/backup/backup-azure-enhanced-soft-delete-about
3. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11.1 Establish and Maintain a Data Recovery Process | X | X | X |
| v7 | 10.4 Ensure Protection of Backups | X | X | X |

## Profile

Level 1 | Automated
