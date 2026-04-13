---
name: cis-azure-foundations-9.3.3.1
description: "Ensure 'Default to Microsoft Entra authorization in the Azure portal' is set to 'Enabled'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, entra-id, authorization, iam]
cis_id: "9.3.3.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Default to Microsoft Entra authorization in the Azure portal' is set to 'Enabled'

## Description

When this property is enabled, the Azure portal authorizes requests to blobs, files, queues, and tables with Microsoft Entra ID by default.

## Rationale

Microsoft Entra ID provides superior security and ease of use over Shared Key.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Settings`, click `Configuration`.
4. Ensure that `Default to Microsoft Entra authorization in the Azure portal` is set to `Enabled`.
5. Repeat steps 1-4 for each storage account.

### Audit from Azure CLI

Run the following command to get the `name` and `defaultToOAuthAuthentication` setting for each storage account:

```bash
az storage account list --query [*].[name,defaultToOAuthAuthentication]
```

Ensure that `true` is returned for each storage account.

## Expected Result

`defaultToOAuthAuthentication` should be `true` for all storage accounts.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage accounts`.
2. Click the name of a storage account.
3. Under `Settings`, click `Configuration`.
4. Under `Default to Microsoft Entra authorization in the Azure portal`, click the radio button next to `Enabled`.
5. Click `Save`.
6. Repeat steps 1-5 for each storage account requiring remediation.

### Remediate from Azure CLI

For each storage account requiring remediation, run the following command to enable `defaultToOAuthAuthentication`:

```bash
az storage account update --resource-group <resource-group> --name <storage-account> --set defaultToOAuthAuthentication=true
```

## Default Value

By default, `defaultToOAuthAuthentication` is disabled.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal#default-to-microsoft-entra-authorization-in-the-azure-portal
2. https://learn.microsoft.com/en-us/cli/azure/storage/account

## Profile

Level 1
