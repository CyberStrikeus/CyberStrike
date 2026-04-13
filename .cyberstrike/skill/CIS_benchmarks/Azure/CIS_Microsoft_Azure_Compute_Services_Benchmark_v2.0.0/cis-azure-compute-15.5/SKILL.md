---
name: cis-azure-compute-15.5
description: "Ensure public network access is disabled for Batch accounts"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.5"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure public network access is disabled for Batch accounts

## Description

Disabling public network access ensures all connectivity occurs through private endpoints or approved virtual networks.

## Rationale

Public network access exposes Batch accounts to internet threats like DDoS attacks and unauthorized access, violating Zero Trust principles and compliance requirements for secure data processing environments.

## Impact

A virtual network or private endpoint should be implemented for the Batch account prior to disabling public network access.

## Audit Procedure

### Using Azure Portal

1. Login to `https://portal.azure.com`
2. For each Batch Account, click on the Batch account name
3. Navigate to the `Settings` drop-down, then click `Networking`.
4. Under the `Public access` tab, ensure that Public Network Access is set to `Disabled`.

Repeat for each Batch account in scope.

### Using Azure CLI

```bash
az batch account show \
  --name <batch-account-name> \
  --resource-group <resource-group> \
  --query "publicNetworkAccess"
```

### Using Azure PowerShell

```powershell
(Get-AzBatchAccount -Name "<batch-account-name>").PublicNetworkAccess
```

Expected Output: **Disabled**

## Expected Result

The `publicNetworkAccess` setting should be `Disabled` for all Batch accounts.

## Remediation

### Using Azure Portal

1. Login to `https://portal.azure.com`
2. For each Batch Account, click on the Batch account name
3. Navigate to the `Settings` drop-down, then click `Networking`.
4. Under the `Public access` tab, ensure that Public Network Access is set to `Disabled`.
5. Click `Save`

Repeat for each Batch account in scope.

### Using Azure CLI

```bash
az batch account update \
  --name <account-name> \
  --resource-group <rg-name> \
  --public-network-access Disabled
```

### Using Azure PowerShell

```powershell
Update-AzBatchAccount -Name <account-name> -ResourceGroupName <rg-name> -PublicNetworkAccess Disabled
```

## Default Value

Public network access is **enabled** by default for new Batch accounts.

## References

1. https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/batch-security-baseline#ns-4
2. https://learn.microsoft.com/en-us/azure/batch/private-connectivity

## Profile

Level 1 | Automated
