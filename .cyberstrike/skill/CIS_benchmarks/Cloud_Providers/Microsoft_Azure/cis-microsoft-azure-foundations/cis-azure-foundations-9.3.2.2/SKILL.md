---
name: cis-azure-foundations-9.3.2.2
description: "Ensure 'Public Network Access' is 'Disabled' for storage accounts"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, networking, public-access, network-security]
cis_id: "9.3.2.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Public Network Access' is 'Disabled' for storage accounts

## Description

Disable public network access to prevent exposure to the internet and reduce the risk of unauthorized access. Use private endpoints to securely manage access within trusted networks.

Disallowing public network access for a storage account overrides the public access settings for individual containers in that storage account.

## Rationale

Disabling public network access improves security by ensuring that a storage account is not exposed on the public internet. The default network configuration for a storage account permits a user with appropriate permissions to configure public network access to containers and blobs in a storage account. It is recommended not to provide public network access to storage accounts until, and unless, it is strongly desired. A shared access signature token or Azure AD RBAC should be used for providing controlled and timed access to blob containers.

## Impact

**NOTE:** Prior to disabling public network access, it is strongly recommended that, for each storage account, either virtual network integration is completed OR private endpoints/links are set up as described in "Ensure Private Endpoints are used to access Storage Accounts."

Disabling public network access restricts direct access to the service. This enhances security but will require the configuration of a virtual network and/or private endpoints for any services or users needing access within trusted networks. Access will have to be managed using shared access signatures or via Azure AD RBAC.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under the `Security + networking` section, click `Networking`.
3. Ensure the `Public network access` setting is set to `Disabled`.

### Audit from Azure CLI

Ensure `publicNetworkAccess` is `Disabled`:

```bash
az storage account show --name <storage-account> --resource-group <resource-group> --query "{publicNetworkAccess:publicNetworkAccess}"
```

### Audit from PowerShell

For each Storage Account, ensure `PublicNetworkAccess` is `Disabled`:

```powershell
Get-AzStorageAccount -Name <storage account name> -ResourceGroupName <resource group name> |select PublicNetworkAccess
```

## Expected Result

`PublicNetworkAccess` should be `Disabled` for all storage accounts.

## Remediation

### Remediate from Azure Portal

First, follow Microsoft documentation and create shared access signature tokens for your blob containers. Then,

1. Go to `Storage Accounts`.
2. For each storage account, under the `Security + networking` section, click `Networking`.
3. Set `Public network access` to `Disabled`.
4. Click `Save`.

### Remediate from Azure CLI

Set 'Public Network Access' to `Disabled` on the storage account:

```bash
az storage account update --name <storage-account> --resource-group <resource-group> --public-network-access Disabled
```

### Remediate from PowerShell

For each Storage Account, run the following to set the `PublicNetworkAccess` setting to `Disabled`:

```powershell
Set-AzStorageAccount -ResourceGroupName <resource group name> -Name <storage account name> -PublicNetworkAccess Disabled
```

## Default Value

By default, `Public Network Access` is set to `Enabled from all networks` for the Storage Account.

## References

1. https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-configure
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls
4. https://learn.microsoft.com/en-us/azure/storage/blobs/assign-azure-role-data-access
5. https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security

## Profile

Level 1
