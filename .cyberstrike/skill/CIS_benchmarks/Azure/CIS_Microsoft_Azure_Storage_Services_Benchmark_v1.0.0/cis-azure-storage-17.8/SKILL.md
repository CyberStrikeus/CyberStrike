---
name: cis-azure-storage-17.8
description: "Ensure Storage Logging is Enabled for Queue Service for 'Read', 'Write', and 'Delete' requests"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, logging]
cis_id: "17.8"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.8 Ensure Storage Logging is Enabled for Queue Service for 'Read', 'Write', and 'Delete' requests (Automated)

## Description

The Storage Queue service stores messages that may be read by any client who has access to the storage account. A queue can contain an unlimited number of messages, each of which can be up to 64KB in size using version 2011-08-18 or newer. Storage Logging happens server-side and allows details for both successful and failed requests to be recorded in the storage account. These logs allow users to see the details of read, write, and delete operations against the queues. Storage Logging log entries contain the following information about individual requests: Timing information such as start time, end-to-end latency, and server latency, authentication details, concurrency information, and the sizes of the request and response messages.

## Rationale

Storage Analytics logs contain detailed information about successful and failed requests to a storage service. This information can be used to monitor individual requests and to diagnose issues with a storage service. Requests are logged on a best-effort basis.

Storage Analytics logging is not enabled by default for your storage account.

## Impact

Enabling this setting can have a high impact on the cost of the log analytics service and data storage used by logging more data per each request. Do not enable this without determining your need for this level of logging, and do not forget to check in on data usage and projected cost. Some users have seen their logging costs increase from $10 per month to $10,000 per month.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Monitoring`, click `Diagnostics settings`.
3. Select the `queue` tab indented below the storage account.
4. Ensure that at least one diagnostic setting is listed.
5. Click `Edit setting` on a diagnostic setting.
6. Ensure that at least one diagnostic setting has `StorageRead`, `StorageWrite`, and `StorageDelete` options selected under the `Logs` section and that they are sent to an appropriate destination.

### Audit from Azure CLI

Ensure the below command's output contains properties `delete`, `read` and `write` set to `true`:

```bash
az storage logging show --services q --account-name <storageAccountName>
```

### Audit from Azure Policy

Policy ID: `7bd000e3-37c7-4928-9f31-86c4b77c5c45` - Name: 'Configure diagnostic settings for Queue Services to Log Analytics workspace'

## Expected Result

Storage logging should be enabled for Queue Service with `StorageRead`, `StorageWrite`, and `StorageDelete` all enabled. CLI output should show `delete: true`, `read: true`, and `write: true`.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Monitoring`, click `Diagnostics settings`.
3. Select the `queue` tab indented below the storage account.
4. To create a new diagnostic setting, click `+ Add diagnostic setting`. To update an existing diagnostic setting, click `Edit setting` on the diagnostic setting.
5. Check the boxes next to `StorageRead`, `StorageWrite`, and `StorageDelete`.
6. Select an appropriate destination.
7. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable the Storage Logging for Queue service:

```bash
az storage logging update --account-name <storageAccountName> --account-key <storageAccountKey> --services q --log rwd --retention 90
```

## Default Value

By default storage account queue services are not logged.

## References

1. https://docs.microsoft.com/en-us/rest/api/storageservices/about-storage-analytics-logging
2. https://docs.microsoft.com/en-us/cli/azure/storage/logging?view=azure-cli-latest
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-4-enable-network-logging-for-security-investigation
4. https://docs.microsoft.com/en-us/azure/storage/queues/monitor-queue-storage?tabs=azure-portal

## Additional Information

We cannot practically generalize detailed audit log requirements for every queue due to their nature and intent. This recommendation may be applicable to storage account queue services where the security is paramount.

## Profile

Level 2 | Automated
