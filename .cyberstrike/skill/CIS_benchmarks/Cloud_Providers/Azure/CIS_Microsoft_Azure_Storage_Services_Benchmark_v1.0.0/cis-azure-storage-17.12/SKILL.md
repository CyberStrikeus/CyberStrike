---
name: cis-azure-storage-17.12
description: "Ensure 'Cross Tenant Replication' is not enabled"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, replication]
cis_id: "17.12"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.12 Ensure 'Cross Tenant Replication' is not enabled (Automated)

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

### Audit from Azure Policy

Policy ID: `92a89a79-6c52-4a7e-a03f-61306fc49312` - Name: 'Storage accounts should prevent cross tenant object replication'

## Expected Result

Cross Tenant Replication should be disabled (not checked) for all storage accounts. CLI output should show `false` for `allowCrossTenantReplication` for each storage account.

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

1. https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-prevent-cross-tenant-policies?tabs=portal

## Profile

Level 1 | Automated
