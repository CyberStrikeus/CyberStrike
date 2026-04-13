---
name: cis-azure-compute-15.4
description: "Ensure Private endpoints are considered for Batch accounts"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, batch]
cis_id: "15.4"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Private endpoints are considered for Batch accounts

## Description

Private endpoints for Azure Batch accounts ensure all network communication occurs over private networks rather than the public internet.

## Rationale

Configuring private endpoints for Azure Batch accounts ensures all network traffic remains within the Microsoft Azure backbone network, eliminating exposure to public internet threats. This meets zero-trust security principles by enforcing network-level isolation and reducing the attack surface. The configuration also enables precise network monitoring through Azure Network Watcher and NSG flow logs.

## Impact

Private endpoints come with an increased cost and complexity.

## Audit Procedure

### Using Azure Portal

1. Login to Azure Portal `https://portal.azure.com/`
2. Navigate to `Batch Accounts`

For each Batch Account, perform the following:

1. Under Settings, click on `Networking`
2. Click the `Private access` tab
3. For each Private Endpoint listed, ensure that the connection state is `Approved`

### Using Azure CLI

To list Private Endpoints from CLI:

```bash
az network private-endpoint list \
    --resource-group <RESOURCE_GROUP> \
    --query "[?privateLinkServiceConnections[?contains(properties.privateLinkServiceId, 'Microsoft.Batch/batchAccounts/<BATCH_ACCOUNT_NAME>')]]"
```

Expected: Should return at least one private endpoint configuration.

### Using Azure PowerShell

To list Private Endpoints from PowerShell:

```powershell
Get-AzPrivateEndpoint -ResourceGroupName <RESOURCE_GROUP> |
    Where-Object { $_.PrivateLinkServiceConnections.PrivateLinkServiceId -match "Microsoft.Batch/batchAccounts/<BATCH_ACCOUNT_NAME>" }
```

## Expected Result

At least one private endpoint should be configured and in `Approved` connection state for each Batch account.

## Remediation

### Using Azure Portal

1. Navigate to your Batch account
2. Under the Settings drop down, click `Networking`
3. Click the `Private access` tab
4. Click `+ Private endpoint`
5. Configure:
   - Virtual network and subnet
   - DNS integration (auto-approved recommended)
   - Target subresource: batchAccount

### Using Azure CLI

```bash
az network private-endpoint create \
  --name batch-pe \
  --resource-group <rg> \
  --vnet-name <vnet> \
  --subnet <subnet> \
  --private-connection-resource-id /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Batch/batchAccounts/<account> \
  --group-id batchAccount \
  --connection-name batch-connection
```

## Default Value

Private endpoints are not configured by default.

## References

1. https://docs.microsoft.com/en-us/azure/batch/private-connectivity

## Profile

Level 2 | Automated
