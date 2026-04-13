---
name: cis-azure-storage-5.2.2
description: "Ensure immutability for Recovery Services vaults is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, recovery-services, backup, immutability, vault-lock, data-protection]
cis_id: "5.2.2"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.2 Ensure immutability for Recovery Services vaults is Enabled (Automated)

## Description

Immutable vaults safeguard backup data by preventing any operations that could result in the loss of recovery points. The immutable vault setting can be locked, making it irreversible and preventing malicious actors from disabling it and deleting backups.

## Rationale

Enabling the immutable vault ensures that backup data is protected from unauthorized or accidental deletion. By locking the setting and making it irreversible, malicious actors are prevented from disabling the setting and deleting backups.

## Impact

There is no additional cost for enabling vault immutability; however, a vault with locked immutability cannot be deleted without contacting Azure support and will incur the standard vault costs.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Recovery Services vaults`.
2. From the list of vaults, ensure that the value in the `Immutability` column for each vault is `Not locked` or `Locked`.

### Audit from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault, run the following command:

```bash
az backup vault show --resource-group <resource-group> --name <recovery-services-vault>
```

Ensure that under `immutabilitySettings`, `state` is set to `Unlocked` or `Locked`.

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.
If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `d6f6f560-14b7-49a4-9fc8-d2c3a9807868`
- Name: '[Preview]: Immutability must be enabled for Recovery Services vaults'

## Expected Result

- In Azure Portal, the `Immutability` column shows `Not locked` or `Locked` for each vault
- In Azure CLI output, `immutabilitySettings.state` is set to `Unlocked` or `Locked`

## Remediation

### Remediate from Azure Portal

1. Go to `Recovery Services vaults`.
2. Click the name of a Recovery Services vault.
3. Under `Settings`, click `Properties`.
4. Under `Immutable vault`, click `Settings`.
5. Check the box under `Enable vault immutability`. Note: It is not possible to lock immutability until immutability has been enabled.
6. Click `Apply`.
7. If it is appropriate for your organization to lock immutability, under `Immutable vault`, click `Settings`.
8. Click the toggle under `Lock immutability for this vault` to set it to `Locked`.
9. Check the box next to `Confirm locking immutability`.
10. Click `Apply`.
11. Repeat steps 1-10 for each Recovery Services vault requiring remediation.

### Remediate from Azure CLI

Run the following command to list Recovery Services vaults:

```bash
az backup vault list
```

For each Recovery Services vault requiring remediation, run the following command to enable vault immutability:

```bash
az backup vault update --resource-group <resource-group> --name <recovery-services-vault> --immutability-state Unlocked
```

Note: To lock the Recovery Services vault immutability state, the above command can be executed with `--immutability-state Locked`. Once enabled, this setting cannot be disabled and it will not be possible to delete the vault.

## Default Value

Immutability is disabled by default on Recovery Services vaults.

## References

No specific references listed for this control beyond the CIS Controls mapping.

### CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11.1 Establish and Maintain a Data Recovery Process - Establish and maintain a data recovery process. In the process, address the scope of data recovery activities, recovery prioritization, and the security of backup data. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | X | X | X |
| v7 | 10.4 Ensure Protection of Backups - Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services. | X | X | X |

## Profile

Level 1 | Automated
