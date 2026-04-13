---
name: cis-azure-storage-17.6
description: "Ensure 'Allow Azure services on the trusted services list to access this storage account' is Enabled for Storage Account Access"
category: cis-azure-storage
version: "1.0.0"
author: cyberstrike-official
tags: [cis, azure, storage, storage-accounts, networking]
cis_id: "17.6"
cis_benchmark: "CIS Microsoft Azure Storage Services Benchmark v1.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 17.6 Ensure 'Allow Azure services on the trusted services list to access this storage account' is Enabled for Storage Account Access (Automated)

## Description

NOTE: This recommendation assumes that the `Public network access` parameter is set to `Enabled from selected virtual networks and IP addresses`. Please ensure the prerequisite recommendation has been implemented before proceeding:

- Ensure Default Network Access Rule for Storage Accounts is Set to Deny

Some Azure services that interact with storage accounts operate from networks that can't be granted access through network rules. To help this type of service work as intended, allow the set of trusted Azure services to bypass the network rules. These services will then use strong authentication to access the storage account. If the `Allow Azure services on the trusted services list to access this storage account` exception is enabled, the following services are granted access to the storage account: Azure Backup, Azure Data Box, Azure DevTest Labs, Azure Event Grid, Azure Event Hubs, Azure File Sync, Azure HDInsight, Azure Import/Export, Azure Monitor, Azure Networking Services, and Azure Site Recovery (when registered in the subscription).

## Rationale

Turning on firewall rules for a storage account will block access to incoming requests for data, including from other Azure services. We can re-enable this functionality by allowing access to `trusted Azure services` through networking exceptions.

## Impact

This creates authentication credentials for services that need access to storage resources so that services will no longer need to communicate via network request. There may be a temporary loss of communication as you set each Storage Account. It is recommended to not do this on mission-critical resources during business hours.

## Audit Procedure

### Audit from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Security + networking`, click `Networking`.
3. Click on the `Firewalls and virtual networks` heading.
4. Under `Exceptions`, ensure that `Allow Azure services on the trusted services list to access this storage account` is checked.

### Audit from Azure CLI

Ensure `bypass` contains `AzureServices`:

```bash
az storage account list --query '[*].networkRuleSet'
```

### Audit from PowerShell

```powershell
Connect-AzAccount
Set-AzContext -Subscription <subscription ID>
Get-AzStorageAccountNetworkRuleset -ResourceGroupName <resource group> -Name <storage account name> |Select-Object Bypass
```

If the response from the above command is `None`, the storage account configuration is out of compliance with this check. If the response is `AzureServices`, the storage account configuration is in compliance with this check.

### Audit from Azure Policy

Policy ID: `c9d007d0-c057-4772-b18c-01e546713bcd` - Name: 'Storage accounts should allow access from trusted Microsoft services'

## Expected Result

The `Allow Azure services on the trusted services list to access this storage account` exception should be checked/enabled. CLI output should show `AzureServices` in the bypass field.

## Remediation

### Remediate from Azure Portal

1. Go to `Storage Accounts`.
2. For each storage account, under `Security + networking`, click `Networking`.
3. Click on the `Firewalls and virtual networks` heading.
4. Under `Exceptions`, check the box next to `Allow Azure services on the trusted services list to access this storage account`.
5. Click `Save`.

### Remediate from Azure CLI

Use the below command to update `bypass` to `Azure services`:

```bash
az storage account update --name <StorageAccountName> --resource-group <resourceGroupName> --bypass AzureServices
```

## Default Value

By default, Storage Accounts will accept connections from clients on any network.

## References

1. https://docs.microsoft.com/en-us/azure/storage/common/storage-network-security
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-network-security#ns-2-secure-cloud-native-services-with-network-controls

## Profile

Level 2 | Automated
