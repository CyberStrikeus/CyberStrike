---
name: cis-azure-foundations-9.2.2
description: "Ensure soft delete for containers on Azure Blob Storage storage accounts is Enabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, blob-storage, storage, soft-delete, containers, data-protection]
cis_id: "9.2.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure soft delete for containers on Azure Blob Storage storage accounts is Enabled

## Description

Containers in Azure storage accounts may contain sensitive or personal data, such as ePHI or financial information. Data that is erroneously modified or deleted by an application or a user can lead to data loss or unavailability.

It is recommended that soft delete for containers be enabled on Azure storage accounts with blob storage to allow for the preservation and recovery of data when containers are deleted.

## Rationale

Containers can be deleted incorrectly. An attacker or malicious user may do this deliberately in order to cause disruption. Deleting a container results in immediate data loss. Enabling this configuration for Azure storage accounts ensures that even if containers are deleted from the storage account, the containers are recoverable for a specific period of time, which is defined in the "Retention policies," ranging from 7 to 365 days.

## Impact

All soft-deleted data is billed at the same rate as active data. Additional costs may be incurred for deleted containers until the soft delete period ends and the data is permanently removed.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. For each Storage Account with blob storage, under `Data management`, go to `Data protection`.
3. Ensure that `Enable soft delete for containers` is checked.
4. Ensure that the retention period is a sufficient length for your organization.

### Audit from Azure CLI

Run the following command to list storage accounts:

```bash
az storage account list
```

Run the following command to determine if a storage account has containers:

```bash
az storage container list --account-name <storage-account>
```

For each storage account with containers, run the following command to get the retention settings:

```bash
az storage account blob-service-properties show --resource-group <resource-group> --account-name <storage-account> --query containerDeleteRetentionPolicy
```

Ensure that `enabled` is set to `true` and `days` is not `null`.

## Expected Result

Container soft delete should be enabled with `enabled` set to `true` and `days` set to an appropriate retention period.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. For each Storage Account with blob storage, under `Data management`, go to `Data protection`.
3. Check the box next to `Enable soft delete for containers`.
4. Set the retention period to a sufficient length for your organization.
5. Click `Save`.

### Remediate from Azure CLI

Run the following command to update container retention:

```bash
az storage account blob-service-properties update --resource-group <resource-group> --account-name <storage-account> --enable-container-delete-retention true --container-delete-retention-days <retention-days>
```

## Default Value

Soft delete for containers is **enabled** by default on storage accounts created via the Azure Portal, and **disabled** by default on storage accounts created via Azure CLI or PowerShell.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-overview
2. https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-enable

## Profile

Level 1
