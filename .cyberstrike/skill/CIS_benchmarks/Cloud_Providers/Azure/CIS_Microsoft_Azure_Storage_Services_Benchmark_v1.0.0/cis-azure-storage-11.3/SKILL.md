---
name: cis-azure-storage-11.3
description: "Ensure that soft delete for blobs on Azure Blob Storage storage accounts is Enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, blob-storage, soft-delete]
cis_id: "11.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.3 Ensure that soft delete for blobs on Azure Blob Storage storage accounts is Enabled (Automated)

## Description

Blobs in Azure storage accounts may contain sensitive or personal data, such as ePHI or financial information. Data that is erroneously modified or deleted by an application or a user can lead to data loss or unavailability.

It is recommended that soft delete be enabled on Azure storage accounts with blob storage to allow for the preservation and recovery of data when blobs or blob snapshots are deleted.

## Rationale

Blobs can be deleted incorrectly. An attacker or malicious user may do this deliberately in order to cause disruption. Deleting an Azure storage blob results in immediate data loss. Enabling this configuration for Azure storage accounts ensures that even if blobs are deleted from the storage account, the blobs are recoverable for a specific period of time, which is defined in the "Retention policies," ranging from 7 to 365 days.

## Impact

All soft-deleted data is billed at the same rate as active data. Additional costs may be incurred for deleted blobs until the soft delete period ends and the data is permanently removed.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account with blob storage, under `Data management`, go to `Data protection`.
3. Ensure that `Enable soft delete for blobs` is checked.
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

For each storage account with containers, ensure that the output of the below command contains `"enabled": true` and `days` is not `null`:

```bash
az storage blob service-properties delete-policy show --account-name <storage-account>
```

## Expected Result

`enabled` is `true` and `days` is set to a value between 7 and 365, inclusive, appropriate for the organization.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account with blob storage, under `Data management`, go to `Data protection`.
3. Check the box next to `Enable soft delete for blobs`.
4. Set the retention period to a sufficient length for your organization.
5. Click `Save`.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to enable soft delete for blobs:

```bash
az storage blob service-properties delete-policy update --days-retained <retention-days> --account-name <storage-account> --enable true
```

## Default Value

Soft delete for blob storage is enabled by default on storage accounts created via the Azure Portal, and disabled by default on storage accounts created via Azure CLI or PowerShell.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview

## Profile

Level 1 | Automated
