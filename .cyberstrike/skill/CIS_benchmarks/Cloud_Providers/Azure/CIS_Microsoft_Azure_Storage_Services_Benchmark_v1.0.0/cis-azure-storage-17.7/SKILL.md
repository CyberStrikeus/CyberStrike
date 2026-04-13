---
name: cis-azure-storage-17.7
description: "Ensure Soft Delete is Enabled for Azure Containers and Blob Storage"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, soft-delete]
cis_id: "17.7"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.7 Ensure Soft Delete is Enabled for Azure Containers and Blob Storage (Automated)

## Description

The Azure Storage blobs contain data like ePHI or Financial, which can be secret or personal. Data that is erroneously modified or deleted by an application or other storage account user will cause data loss or unavailability.

It is recommended that both Azure Containers with attached Blob Storage and standalone containers with Blob Storage be made recoverable by enabling the soft delete configuration. This is to save and recover data when blobs or blob snapshots are deleted.

## Rationale

Containers and Blob Storage data can be incorrectly deleted. An attacker/malicious user may do this deliberately in order to cause disruption. Deleting an Azure Storage blob causes immediate data loss. Enabling this configuration for Azure storage ensures that even if blobs/data were deleted from the storage account, Blobs/data objects are recoverable for a particular time which is set in the "Retention policies," ranging from 7 days to 365 days.

## Impact

Additional storage costs may be incurred as snapshots are retained.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account, under `Data management`, go to `Data protection`.
3. Ensure that `Enable soft delete for blobs` is checked.
4. Ensure that `Enable soft delete for containers` is checked.
5. Ensure that the retention period for both is a sufficient length for your organization.

### Audit from Azure CLI

**Blob Storage:** Ensure that the output of the below command contains enabled status as true and days is not empty or null:

```bash
az storage blob service-properties delete-policy show
    --account-name <storageAccount>
    --account-key <accountkey>
```

**Azure Containers:** Ensure that within `containerDeleteRetentionPolicy`, the `enabled` property is set to `true`:

```bash
az storage account blob-service-properties show
    --account-name <storageAccount>
    --resource-group <resourceGroup>
```

## Expected Result

Soft delete should be enabled for both blobs and containers with an appropriate retention period (7-365 days). CLI output should show `enabled: true` for both blob delete policy and container delete retention policy.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each Storage Account, under `Data management`, go to `Data protection`.
3. Check the box next to `Enable soft delete for blobs`.
4. Check the box next to `Enable soft delete for containers`.
5. Set the retention period for both to a sufficient length for your organization.
6. Click `Save`.

### Remediate from Azure CLI

Update blob storage retention days in below command:

```bash
az storage blob service-properties delete-policy update --days-retained <RetentionDaysValue> --account-name <StorageAccountName> --account-key <AccountKey> --enable true
```

Update container retention with the below command:

```bash
az storage account blob-service-properties update
    --enable-container-delete-retention true
    --container-delete-retention-days <days>
    --account-name <storageAccount>
    --resource-group <resourceGroup>
```

## Default Value

Soft delete for containers and blob storage is enabled by default on storage accounts created via the Azure Portal, and disabled by default on storage accounts created via Azure CLI or PowerShell.

## References

1. https://docs.microsoft.com/en-us/azure/storage/blobs/storage-blob-soft-delete
2. https://docs.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-overview
3. https://docs.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-enable?tabs=azure-portal

## Profile

Level 1 | Automated
