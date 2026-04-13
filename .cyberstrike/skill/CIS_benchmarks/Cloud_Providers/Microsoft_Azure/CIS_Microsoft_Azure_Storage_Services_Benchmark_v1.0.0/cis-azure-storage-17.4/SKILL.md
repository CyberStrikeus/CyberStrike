---
name: cis-azure-storage-17.4
description: "Ensure that 'Secure transfer required' is set to 'Enabled'"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, encryption, tls]
cis_id: "17.4"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.4 Ensure that 'Secure transfer required' is set to 'Enabled' (Automated)

## Description

Enable data encryption in transit.

## Rationale

The secure transfer option enhances the security of a storage account by only allowing requests to the storage account by a secure connection. For example, when calling REST APIs to access storage accounts, the connection must use HTTPS. Any requests using HTTP will be rejected when 'secure transfer required' is enabled. When using the Azure files service, connection without encryption will fail, including scenarios using SMB 2.1, SMB 3.0 without encryption, and some flavors of the Linux SMB client. Because Azure storage doesn't support HTTPS for custom domain names, this option is not applied when using a custom domain name.

## Impact

No specific impact noted. This is a standard security best practice.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Ensure that `Secure transfer required` is set to `Enabled`.

### Audit from Azure CLI

Use the below command to ensure the `Secure transfer required` is enabled for all the `Storage Accounts` by ensuring the output contains `true` for each of the `Storage Accounts`.

```bash
az storage account list --query "[*].[name,enableHttpsTrafficOnly]"
```

### Audit from Azure Policy

Policy ID: `404c3081-a854-4457-ae30-26a93ef643f9` - Name: 'Secure transfer to storage accounts should be enabled'

## Expected Result

The `Secure transfer required` setting should be `Enabled` for all storage accounts. The CLI output should show `true` for `enableHttpsTrafficOnly` for each storage account.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Settings`, click `Configuration`.
3. Set `Secure transfer required` to `Enabled`.
4. Click `Save`.

### Remediate from Azure CLI

Use the below command to enable `Secure transfer required` for a `Storage Account`:

```bash
az storage account update --name <storageAccountName> --resource-group <resourceGroupName> --https-only true
```

## Default Value

By default, `Secure transfer required` is set to `Disabled`.

## References

1. https://docs.microsoft.com/en-us/azure/storage/blobs/security-recommendations#encryption-in-transit
2. https://docs.microsoft.com/en-us/cli/azure/storage/account?view=azure-cli-latest#az_storage_account_list
3. https://docs.microsoft.com/en-us/cli/azure/storage/account?view=azure-cli-latest#az_storage_account_update
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-data-protection#dp-3-encrypt-sensitive-data-in-transit

## Profile

Level 1 | Automated
