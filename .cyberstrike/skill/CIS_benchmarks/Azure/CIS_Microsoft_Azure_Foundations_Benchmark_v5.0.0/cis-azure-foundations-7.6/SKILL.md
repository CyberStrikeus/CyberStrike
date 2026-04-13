---
name: cis-azure-foundations-7.6
description: "Ensure Network Watcher is 'Enabled' for Azure Regions that are in use"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, networking, nsg]
cis_id: "7.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-7.5, cis-azure-foundations-7.8]
prerequisites: []
severity_boost: {}
---

# Ensure Network Watcher is 'Enabled' for Azure Regions that are in use

## Description

Enable Network Watcher for physical regions in Azure subscriptions.

## Rationale

Network diagnostic and visualization tools available with Network Watcher help users understand, diagnose, and gain insights to the network in Azure.

## Impact

There are additional costs per transaction to run and store network data. For high-volume networks these charges will add up quickly.

## Audit Procedure

### Using Azure Portal

1. Use the Search bar to search for and click on the `Network Watcher` service.
2. From the Overview menu item, review each Network Watcher listed, and ensure that a network watcher is listed for each region in use by the subscription.

### Using Azure CLI

```bash
az network watcher list --query "[].{Location:location,State:provisioningState}" -o table
```

This will list all network watchers and their provisioning state. Ensure `provisioningState` is `Succeeded` for each network watcher.

```bash
az account list-locations --query "[?metadata.regionType=='Physical'].{Name:name,DisplayName:regionalDisplayName}" -o table
```

This will list all physical regions that exist in the subscription. Compare this list to the previous one to ensure that for each region in use, a network watcher exists with `provisioningState` set to `Succeeded`.

### Using PowerShell

```powershell
Get-AzNetworkWatcher
```

Make sure each watcher is set with the `ProvisioningState` setting set to `Succeeded` and all `Locations` that are in use by the subscription are using a watcher.

### Using Azure Policy

- **Policy ID:** b6e2945c-0b7b-40f5-9233-7a5323b5cdc6 - **Name:** 'Network Watcher should be enabled'

## Expected Result

A Network Watcher should exist with `ProvisioningState` set to `Succeeded` for every Azure region in use by the subscription.

## Remediation

Opting out of Network Watcher automatic enablement is a permanent change. Once you opt-out you cannot opt-in without contacting support.

To manually enable Network Watcher in each region where you want to use Network Watcher capabilities, follow the steps below.

### Remediate from Azure Portal

1. Use the Search bar to search for and click on the `Network Watcher` service.
2. Click `Create`.
3. Select a `Region` from the drop-down menu.
4. Click `Add`.

### Remediate from Azure CLI

```bash
az network watcher configure --locations <region> --enabled true --resource-group <resource_group>
```

## Default Value

Network Watcher is automatically enabled. When you create or update a virtual network in your subscription, Network Watcher will be enabled automatically in your Virtual Network's region. There is no impact to your resources or associated charge for automatically enabling Network Watcher.

## References

1. https://learn.microsoft.com/en-us/azure/network-watcher/network-watcher-overview
2. https://learn.microsoft.com/en-us/cli/azure/network/watcher
3. https://learn.microsoft.com/en-us/cli/azure/network/watcher#az-network-watcher-configure
4. https://learn.microsoft.com/en-us/azure/network-watcher/network-watcher-create
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-logging-threat-detection#lt-4-enable-network-logging-for-security-investigation
6. https://azure.microsoft.com/en-us/pricing/details/network-watcher/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v8 | 12.4 Establish and Maintain Architecture Diagram(s) | | x | x |
| v7 | 11.2 Document Traffic Configuration Rules | | x | x |
| v7 | 12.1 Maintain an Inventory of Network Boundaries | x | x | x |

## Profile

Level 2 | Automated
