---
name: cis-azure-storage-5.1.2
description: "Ensure immutability for Backup vaults is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, backup, backup-vaults, immutability]
cis_id: "5.1.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Ensure immutability for Backup vaults is Enabled (Automated)

## Description

Immutable vaults safeguard backup data by preventing any operations that could result in the loss of recovery points. The immutable vault setting can be locked, making it irreversible and preventing malicious actors from disabling it and deleting backups.

## Rationale

Enabling the immutable vault ensures that backup data is protected from unauthorized or accidental deletion. By locking the setting and making it irreversible, malicious actors are prevented from disabling the setting and deleting backups.

## Impact

There is no additional cost for enabling vault immutability; however, a vault with locked immutability cannot be deleted without contacting Azure support and will incur the standard vault costs.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Backup vaults`.
2. From the list of vaults, ensure that the value in the `Immutability` column for each vault is `Not locked` or `Locked`.

### Audit from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault, run the following command:

```bash
az dataprotection backup-vault show --resource-group <resource-group> --vault-name <backup-vault>
```

Ensure that under `immutabilitySettings`, `state` is set to `Unlocked` or `Locked`.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `2514263b-bc0d-4b06-ac3e-f262c0979018`
- Name: '[Preview]: Immutability must be enabled for backup vaults'

## Expected Result

The `Immutability` column should show `Not locked` or `Locked` in the Azure Portal, or `immutabilitySettings.state` should be `Unlocked` or `Locked` in CLI output.

## Remediation

### Remediate from Azure Portal

1. Go to `Backup vaults`.
2. Click the name of a Backup vault.
3. Under `Manage`, click `Properties`.
4. Under the `Immutable vault` setting value, click `Settings`.
5. Check the box under `Enable vault immutability`. Note: It is not possible to lock immutability until immutability has been enabled.
6. Click `Apply`.
7. If it is appropriate for your organization to lock immutability, under the `Immutable vault` setting value, click `Settings`.
8. Click the toggle under `Lock immutability for this vault` to set it to `Locked`.
9. Check the box next to `Confirm locking immutability`.
10. Click `Apply`.
11. Repeat steps 1-10 for each Backup vault requiring remediation.

### Remediate from Azure CLI

Run the following command to list Backup vaults:

```bash
az dataprotection backup-vault list
```

For each Backup vault requiring remediation, run the following command to enable vault immutability:

```bash
az dataprotection backup-vault update --resource-group <resource-group> --vault-name <backup-vault> --immutability-state Unlocked
```

Note: To lock the Backup vault immutability state, the above command can be executed with `--immutability-state Locked`. Once enabled, this setting cannot be disabled and it will not be possible to delete the vault.

## Default Value

Immutability is disabled by default on Backup vaults.

## References

1. https://learn.microsoft.com/en-us/azure/backup/backup-azure-immutable-vault-concept?tabs=backup-vault
2. https://learn.microsoft.com/en-us/azure/backup/backup-azure-immutable-vault-how-to-manage?tabs=backup-vault
3. https://learn.microsoft.com/en-us/cli/azure/dataprotection/backup-vault
4. https://learn.microsoft.com/en-us/azure/backup/backup-vault-overview

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.1 Establish and Maintain a Data Recovery Process | X    | X    | X    |
| v7               | 10.4 Ensure Protection of Backups                   | X    | X    | X    |

## Profile

Level 1 | Automated
