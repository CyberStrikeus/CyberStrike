---
name: cis-azure-foundations-9.3.7
description: "Ensure 'Cross Tenant Replication' is not enabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, cross-tenant-replication, data-protection, data-governance]
cis_id: "9.3.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Cross Tenant Replication' is not enabled

## Description

Cross Tenant Replication in Azure allows data to be replicated across multiple Azure tenants. While this feature can be beneficial for data sharing and availability, it also poses a significant security risk if not properly managed. Unauthorized data access, data leakage, and compliance violations are potential risks. Disabling Cross Tenant Replication ensures that data is not inadvertently replicated across different tenant boundaries without explicit authorization.

## Rationale

Disabling Cross Tenant Replication minimizes the risk of unauthorized data access and ensures that data governance policies are strictly adhered to. This control is especially critical for organizations with stringent data security and privacy requirements, as it prevents the accidental sharing of sensitive information.

## Impact

Disabling Cross Tenant Replication may affect data availability and sharing across different Azure tenants. Ensure that this change aligns with your organizational data sharing and availability requirements.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Data management`, click `Object replication`.
3. Click `Advanced settings`.
4. Ensure `Allow cross-tenant replication` is not checked.

### Audit from Azure CLI

```bash
az storage account list --query "[*].[name,allowCrossTenantReplication]"
```

The value of `false` should be returned for each storage account listed.

## Expected Result

`allowCrossTenantReplication` should be `false` for all storage accounts.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Data management`, click `Object replication`.
3. Click `Advanced settings`.
4. Uncheck `Allow cross-tenant replication`.
5. Click `OK`.

### Remediate from Azure CLI

Replace the information within <> with appropriate values:

```bash
az storage account update --name <storageAccountName> --resource-group <resourceGroupName> --allow-cross-tenant-replication false
```

## Default Value

For new storage accounts created after Dec 15, 2023 cross tenant replication is not enabled.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-prevent-cross-tenant-policies

## Profile

Level 1
