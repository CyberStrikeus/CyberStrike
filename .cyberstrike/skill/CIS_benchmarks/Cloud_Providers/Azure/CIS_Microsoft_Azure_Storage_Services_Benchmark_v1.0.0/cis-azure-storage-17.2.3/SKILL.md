---
name: cis-azure-storage-17.2.3
description: "Ensure Default Network Access Rule for Storage Accounts is Set to Deny"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, networking, private-endpoints]
cis_id: "17.2.3"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.2.3 Ensure Default Network Access Rule for Storage Accounts is Set to Deny (Automated)

## Description

Restricting default network access helps to provide a new layer of security, since storage accounts accept connections from clients on any network. To limit access to selected networks, the default action must be changed.

## Rationale

Storage accounts should be configured to deny access to traffic from all networks (including internet traffic). Access can be granted to traffic from specific Azure Virtual networks, allowing a secure network boundary for specific applications to be built. Access can also be granted to public internet IP address ranges to enable connections from specific internet or on-premises clients. When network rules are configured, only applications from allowed networks can access a storage account. When calling from an allowed network, applications continue to require proper authorization (a valid access key or SAS token) to access the storage account.

## Impact

All allowed networks will need to be whitelisted on each specific network, creating administrative overhead. This may result in loss of network connectivity, so do not turn on for critical resources during business hours.

## Audit Procedure

### Audit from Azure Portal

1. Go to Storage Accounts.
2. For each storage account, under `Security + networking`, click `Networking`.
3. Click the `Firewalls and virtual networks` heading.
4. Ensure that `Public network access` is not set to `Enabled from all networks`.

### Audit from Azure CLI

Ensure `defaultAction` is not set to `Allow`.

```bash
az storage account list --query '[*].networkRuleSet'
```

### Audit from PowerShell

```powershell
Connect-AzAccount
Set-AzContext -Subscription <subscription ID>
Get-AzStorageAccountNetworkRuleset -ResourceGroupName <resource group> -Name <storage account name> |Select-Object DefaultAction
```

**PowerShell Result - Non-Compliant:**

```
DefaultAction       : Allow
```

**PowerShell Result - Compliant:**

```
DefaultAction       : Deny
```

### Audit from Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure. If referencing a printed copy, you can search Policy IDs from this URL: https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- Policy ID: `34c877ad-507e-4c82-993e-3452a6e0ad3c` - Name: 'Storage accounts should restrict network access'
- Policy ID: `2a1a9cdf-e04d-429a-8416-3bfb72a1b26f` - Name: 'Storage accounts should restrict network access using virtual network rules'

## Expected Result

The `Public network access` setting is not set to `Enabled from all networks` for each storage account. In Azure CLI, the `defaultAction` in `networkRuleSet` is set to `Deny`. In PowerShell, `DefaultAction` returns `Deny`. The Azure Policies 'Storage accounts should restrict network access' and 'Storage accounts should restrict network access using virtual network rules' show compliant.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Security + networking`, click `Networking`.
3. Click the `Firewalls and virtual networks` heading.
4. Set `Public network access` to `Enabled from selected virtual networks and IP addresses`.
5. Add rules to allow traffic from specific networks and IP addresses.
6. Click `Save`.

### Remediate from Azure CLI

Use the below command to update `default-action` to `Deny`.

```bash
az storage account update --name <StorageAccountName> --resource-group <resourceGroupName> --default-action Deny
```

## Default Value

By default, Storage Accounts will accept connections from clients on any network.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-network-security

## Profile

Level 1 | Automated
