---
name: cis-azure-storage-17.10
description: "Ensure Storage Logging is Enabled for Table Service for 'Read', 'Write', and 'Delete' Requests"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, logging]
cis_id: "17.10"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.10 Ensure Storage Logging is Enabled for Table Service for 'Read', 'Write', and 'Delete' Requests (Automated)

## Description

Azure Table storage is a service that stores structured NoSQL data in the cloud, providing a key/attribute store with a schema-less design. Storage Logging happens server-side and allows details for both successful and failed requests to be recorded in the storage account. These logs allow users to see the details of read, write, and delete operations against the tables. Storage Logging log entries contain the following information about individual requests: timing information such as start time, end-to-end latency, and server latency; authentication details; concurrency information; and the sizes of the request and response messages.

## Rationale

Storage Analytics logs contain detailed information about successful and failed requests to a storage service. This information can be used to monitor each individual request to a storage service for increased security or diagnostics. Requests are logged on a best-effort basis.

Storage Analytics logging is not enabled by default for your storage account.

## Impact

Being a level 2, enabling this setting can have a high impact on the cost of data storage used for logging more data per each request. Do not enable this without determining your need for this level of logging or forget to check in on data usage and projected cost.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Monitoring`, click `Diagnostics settings`.
3. Select the `table` tab indented below the storage account.
4. Ensure that at least one diagnostic setting is listed.
5. Click `Edit setting` on a diagnostic setting.
6. Ensure that at least one diagnostic setting has `StorageRead`, `StorageWrite`, and `StorageDelete` options selected under the `Logs` section and that they are sent to an appropriate destination.

### Audit from Azure CLI

Ensure the below command output contains properties delete, read and write set to true:

```bash
az storage logging show --services t --account-name <storageAccountName>
```

### Audit from Azure Policy

Policy ID: `2fb86bf3-d221-43d1-96d1-2434af34eaa0` - Name: 'Configure diagnostic settings for Table Services to Log Analytics workspace'

## Expected Result

Storage logging should be enabled for Table Service with `StorageRead`, `StorageWrite`, and `StorageDelete` all enabled. CLI output should show `delete: true`, `read: true`, and `write: true`.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Monitoring`, click `Diagnostics settings`.
3. Select the `table` tab indented below the storage account.
4. To create a new diagnostic setting, click `+ Add diagnostic setting`. To update an existing diagnostic setting, click `Edit setting` on the diagnostic setting.
5. Check the boxes next to `StorageRead`, `StorageWrite`, and `StorageDelete`.
6. Select an appropriate destination.
7. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable the Storage Logging for Table service:

```bash
az storage logging update --account-name <storageAccountName> --account-key <storageAccountKey> --services t --log rwd --retention 90
```

## Default Value

By default, storage account table service logging is disabled for read, write, and delete operations.

## References

1. https://docs.microsoft.com/en-us/rest/api/storageservices/about-storage-analytics-logging
2. https://docs.microsoft.com/en-us/cli/azure/storage/logging?view=azure-cli-latest
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-3-enable-logging-for-security-investigation

## Additional Information

We cannot practically generalize detailed audit log requirements for every table due to their nature and intent. This recommendation may be applicable to storage account table service where the security is paramount.

## Profile

Level 2 | Automated
