---
name: cis-azure-foundations-9.3.2.3
description: "Ensure default network access rule for storage accounts is set to deny"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, storage-accounts, networking, default-action, firewall, network-rules]
cis_id: "9.3.2.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure default network access rule for storage accounts is set to deny

## Description

Restricting default network access helps to provide a new layer of security, since storage accounts accept connections from clients on any network. To limit access to selected networks, the default action must be changed.

## Rationale

**NOTE:** This recommendation is only applicable if Public Network Access has not been disabled due to necessity or exception.

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

PowerShell Result - Non-Compliant: `DefaultAction : Allow`

PowerShell Result - Compliant: `DefaultAction : Deny`

## Expected Result

`defaultAction` should be set to `Deny` for all storage accounts.

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

1. https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Profile

Level 1
